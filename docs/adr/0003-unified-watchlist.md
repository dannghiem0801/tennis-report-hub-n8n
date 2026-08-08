# Unified watchlist — single sport-agnostic collection for user-curated state

**Status**: proposed
**Date**: 2026-08-08
**Supersedes**: implicit per-sport partition in `app-store.tsx:209, 233, 235, 242, 290-295`

## Context

The Tennis Report Hub currently treats Tennis and Football as two independent
data partitions for everything the user curates:

- `WatchlistEntry[]` — one per sport, swapped in/out of memory on `setActiveSport`
- `Report[]` — one per sport, same swap
- `ScheduledBatch[]` — one per sport, same swap
- `ReportTemplate[]` — one per sport, same swap (templates are config, not
  user-curated state, but live behind the same per-sport gate)

Only Tennis is "active" today; the Football / Basketball tabs in `top-bar.tsx`
are static `cursor-not-allowed` placeholders. So in practice, the user only
ever sees the Tennis partition. But the *intent* of the architecture is that
once Football ships, each sport will have its own independent list, batch,
and report history — and switching tabs will swap the entire user state
in-memory.

The user wants the opposite: one watchlist, one report history, one batch
list — across all sports. When they're viewing Tennis, a Football match in
their watchlist still appears. When a Football match ends, its report
auto-generates regardless of which tab is open. When they schedule a batch,
it can mix sports.

### Why now

Football is moving toward "active" in `top-bar.tsx`. The current
implementation would ship a confusing experience: the same user, with the
same intent ("matches I care about"), would silently see *different* lists
in Tennis vs Football, with no report continuity between them. The
per-sport partition is an artifact of the Tennis-only MVP, not a deliberate
product decision.

### What today actually does (audit)

| Layer | Behavior |
|---|---|
| `persistence.ts` storage | **Already sport-agnostic.** One localStorage key per collection (`trh:watchlist`, `trh:reports`, `trh:scheduledBatches`). The methods ignore the `activeSport` argument `app-store.tsx` passes. |
| `app-store.tsx` state | **Per-sport swap.** Lines 209, 233, 235 lazy-init from storage keyed on `activeSport`. Line 242 `setActiveSport` re-reads from storage and replaces in-memory state. |
| Polling | **Per-active-sport only.** `fetchMatches` (line 311) fetches only the active sport. Polling loop (line 510) inherits this. |
| Auto-on-completion | **Gated on `matches` array.** Lines 570-598 only trigger when a watchlist entry's `matchApiId` is in the current `matches` array. Since `matches` only contains the active sport, cross-sport entries never auto-trigger. |
| UI | `WatchlistSidebar` (line 17) shows all entries in `watchlist` (no sport filter), but the provider hands it a sport-specific array. Result: today the sidebar always shows Tennis entries because Tennis is the only active sport. |

So the "2 watchlists" the user perceives is: the *intended* per-sport
partition, not a storage split. Removing the partition requires changing
the in-memory swap + cross-sport trigger; the storage layer is already
ready.

## Decision

### 1. Scope: merge `WatchlistEntry`, `Report`, `ScheduledBatch` into sport-agnostic collections

`app-store.tsx` no longer swaps these on `setActiveSport`. The lazy-init
reads from the single sport-agnostic storage key. `setActiveSport` becomes
a no-op for these three collections — it still updates the dashboard's
match fetch (which IS still per-sport, see #3).

`ReportTemplate` stays per-sport. Templates are configuration, not
user-curated state, and sport-specific prompts (tennis aces, football
possession) are semantically distinct. A tennis template does not
belong in a football report-generation flow.

### 2. UI: watchlist sidebar groups by sport, sorts by start time within each group

- The existing two top-level tabs (`Đang chờ` / `Đã viết`) are preserved
  as the primary axis — pending vs done.
- Within each tab, the list is **grouped by sport** with a collapsible
  section header per sport (`🎾 Tennis (3)`, `⚽ Football (2)`). Empty
  sport sections are hidden.
- Within each sport section, entries are **sorted by start time**:
  - Pending tab: ascending (next match first). Past-start-time entries
    (i.e. the match should have started but we haven't detected
    completion yet) float to the top in a "Đang quá giờ bắt đầu" subtle
    state.
  - Completed tab: descending (most recent first).
- Each row carries a small sport chip so the user can confirm at a
  glance, even with sections collapsed.
- The "Hẹn giờ" (Scheduled) tab from ADR 0001 stays — batches can now
  mix sports, and the existing UI handles that without changes.

### 3. Dashboard remains per-sport (the "active sport" concept survives, with a narrower role)

`activeSport` continues to control the **dashboard** match list and
fetch. Users still pick a sport to browse fixtures. But the watchlist,
report history, and batches are global.

The top-bar sport switcher goes from "Soon" placeholder to a real
control: clicking Football swaps `activeSport` → re-fetches football
matches for the dashboard → the watchlist sidebar still shows the same
unified list. The user's mental model becomes: "I browse Tennis here,
Football there — but my watchlist is one list."

### 4. Auto-on-completion: per-entry background poll, fires for any sport

Replace the current "trigger via dashboard `matches` array" path with a
dedicated background poll:

- For every watchlist entry with `status === "pending"`, a background
  poll checks its match's completion status. The poll runs at
  `pollingIntervalMinutes` (the same knob the existing dashboard
  polling uses; default 0 = off, opt-in 5/10/15/30 min).
- The poll is **batched by `(sport, date)`** at the API level:
  pending entries are grouped, and each unique pair is fetched once
  per cycle via `getMatchesByDate`. The 30-min cache in
  `flashscore.ts` (`TTL.listByDate`) dedupes — so 10 pending
  entries across 3 dates cost 3 API calls per cycle, not 10, and
  the second cycle within 30 min is fully cache-served.
- When the poll sees `status === "completed"`, it transitions the
  entry to `fetching-pbp` → the existing pipeline
  (`app-store.tsx:619`) picks it up → LLM call fires regardless of
  `activeSport`.
- The current dashboard-driven path (line 570) is kept as a
  *fast-path* — when the user is browsing the active sport and a
  watchlist entry's match is in the current fetch results, the
  pipeline fires immediately. The per-entry poll is the **safety
  net for cross-sport / cross-date entries**, not a replacement for
  the dashboard path.
- Rate-limit handling is shared via the existing `rateLimitUntil`
  cooldown; a 429 from any caller pauses the per-entry poll until
  cooldown ends.

### 5. Polling lifecycle is per-entry, not per-app

- One background `setInterval` per app instance processes all
  pending entries per cycle. The poll re-creates itself whenever
  the *set* of pending entries changes (add, remove, or
  status transition) — a stable string key derived from the
  pending set is the effect's dependency. This is functionally
  equivalent to a `Set<string>` of per-entry polls and far cheaper
  to manage: one timer to clear, one cache layer to dedupe, and
  the per-entry teardown semantics are preserved at the cycle
  level (a transition out of `pending` drops the entry from the
  next cycle's set).
- A "pending" entry becomes "in flight" the moment the poll
  transitions it to `fetching-pbp`. The dashboard fast-path or
  scheduled-batch runner takes over from there. The poll never
  re-fetches an entry that's left the `pending` state.

### 6. One new persistence key: `trh:activeSport`

The `trh:watchlist` / `trh:reports` / `trh:scheduledBatches` /
`trh:seenReports` localStorage keys are already sport-agnostic.
The `WatchlistEntry.sport` field on each entry is already
populated (line 852 in `toggleWatchlist`). The data shape is
right; only the read path changes. **No migration is needed for
these collections.**

**However**, Decision 7 wires the top-bar sport switcher to a
real control. The active sport needs to survive reloads, so
`trh:activeSport` is added. Default: `"tennis"` (the only sport
that's been live in v1). Existing users see no behavior change
on first reload — they land on Tennis as before.

For the unified watchlist / reports / batches themselves, no
migration is needed: existing data appears under the Tennis
section in the new grouped sidebar. No data loss, no merge
script, no dual-read fallback.

### 7. `setActiveSport` becomes a real, wired control

`top-bar.tsx`'s sport tabs (currently `cursor-not-allowed`) become
buttons. `setActiveSport` is called on click. The effect re-fetches
the dashboard matches for the new sport. Watchlist / reports / batches
state is NOT swapped — they remain in memory across the switch.

Football and Basketball are still "Soon" until their upstream data
mapping is complete (`mapMatchesBatch` for football is partially
implemented; basketball is not). The UI will gate each sport chip on a
`<Sport id="football" ready={true/false} />` flag so the chip is
clickable only when the upstream mapping is ready.

## Considered Options

- **Keep per-sport partition, just expose both in the same sidebar.**
  Rejected. The auto-on-completion pipeline still wouldn't fire for the
  inactive sport, the user still has to "remember" to switch tabs to
  see Football reports, and `setActiveSport` semantics get even murkier.
  Doesn't address the core ask.

- **Fully unify everything including `ReportTemplate`.**
  Rejected. Templates encode sport-specific prompt structure
  (tennis aces, football possession stats). A user creating a
  "Tournament Recap" tennis template shouldn't see it in the football
  template picker. Templates are config, not user state, and the
  per-sport split has clear semantic value.

- **Make `activeSport` a *filter* on the watchlist (not a partition).**
  Rejected. "Filter" implies the user can toggle it; "all my tennis
  matches" vs "all my football matches" becomes a chip in the sidebar.
  But this is exactly the partition the user is trying to escape —
  the user wants ONE list, not "one list with a sport filter on top."

- **Detect cross-sport completions via the dual-sport dashboard poll
  (background fetch BOTH sports' matches regardless of active sport).**
  Rejected. Cheaper API-wise than per-entry polling, but requires
  loading the inactive sport's matches into memory just to detect
  completion. The dashboard's `matches` array is the wrong place for
  that — the matches feed the tournament browser, and showing two
  sports' matches there would be UX noise. Per-entry poll is targeted
  to the actual question: "did this specific match end?"

- **Time-based completion detection (assume `now > startTime + 2.5h` =
  match ended).**
  Rejected. Zero extra API calls, but blind: matches can be cancelled,
  retired, postponed, or run 5 hours. The LLM would generate
  "Sinner thất bại trước Alcaraz 6-7 3-6 ret." for a match that was
  never played. Bad for a real product.

- **Move auto-trigger to a backend worker (Supabase / cron).**
  Deferred. Same rationale as ADR 0001: v1 is localStorage-only.
  v2 Supabase backend will move the trigger server-side. The
  per-entry poll pattern transfers cleanly — the backend just runs the
  same poll logic against Postgres-stored entries.

- **Keep templates per-sport, but make the watchlist / reports / batches
  sport-agnostic in storage AND UI (this ADR's choice).**
  Accepted. Cleanest data model. Storage layer requires zero changes.
  UI changes are localized to the watchlist sidebar (group by sport,
  sort by start time) and the top-bar sport switcher (wire to
  `setActiveSport`). Pipeline change is the per-entry poll, which is
  a new effect rather than a rewrite.

## Consequences

- **API cost increase.** Per-entry polling at 5-min cadence with N
  pending watchlist entries across D unique `(sport, date)` pairs
  = D calls per cycle. With 10 pending entries across 3 dates,
  ~36 calls/hour. The 30-min cache in `flashscore.ts`
  (`TTL.listByDate`) dedupes; the second cycle within 30 min is
  fully cache-served. The first cycle after a status change is
  the only call that hits upstream. Net cost is bounded by the
  number of *transitions* per cycle, not the number of entries.

- **Up to 30-min detection lag for cross-sport entries.** The
  30-min `TTL.listByDate` cache means a freshly-completed match
  may still be reported as "live" in the cached response for up
  to 30 minutes. The poll won't fire during that window. The
  dashboard fast-path is unaffected (its `fetchMatches` call
  always re-fetches), so this lag only applies to cross-sport
  / cross-date entries. Acceptable for v1; if a user reports
  this is a problem, the fix is a per-entry cache bust (force
  fresh fetch for an entry whose `startTime + buffer` has
  passed).

- **No new persistence keys.** The `trh:watchlist` / `trh:reports` /
  `trh:scheduledBatches` keys continue to hold all data. `WatchlistEntry`
  retains its `sport` field for the sidebar's group-by-sport rendering.

- **No new UI surfaces.** Existing tabs (`Đang chờ` / `Đã viết` / `Hẹn
  giờ`) are preserved. Sport grouping is a render-time concern inside
  those tabs.

- **No new external service.** Per-entry polling reuses the existing
  Flashscore API integration. The LLM pipeline (`runGeneration`) is
  unchanged — it already handles cross-sport report generation
  (`match.sport === "tennis"` vs `=== "football"` branches at line 784).

- **Storage methods lose their no-op `sport` argument.** `getWatchlist`,
  `getReports`, `getScheduledBatches`, `setWatchlist`, `setReports`,
  `setScheduledBatches` already ignore the argument; the call sites
  in `app-store.tsx` stop passing it. `getTemplates` / `setTemplates`
  still take a sport argument (templates stay per-sport).

- **Top-bar gets a wired sport switcher.** Football and Basketball
  chips become clickable once their upstream mapping is ready. The
  existing `cursor-not-allowed` styling is removed.

- **`setActiveSport` becomes meaningful.** The function is wired to
  the top-bar chips. It re-fetches the dashboard for the new sport
  but does NOT swap the watchlist / reports / batches in-memory state.

- **Per-entry poll lifecycle is tied to entry status.** Polls are
  created on `addToWatchlist` and torn down when the entry leaves
  `pending`. A `useEffect` keyed on the `Set<entryId>` of pending
  entries owns the pollers; cleanup runs on unmount and when the set
  changes.

- **Rate-limit cooldown extends to per-entry poll.** A 429 from any
  upstream caller (dashboard fetch, per-entry poll, per-match details
  fetch) sets `rateLimitUntil`; the per-entry poll effect checks
  this and skips cycles during the cooldown.

- **v2 migration is clean.** When the Supabase backend lands, the
  per-entry poll moves from a client-side `setInterval` per entry to
  a server-side cron job that queries Postgres for `pending` entries
  and dispatches completion checks. The client just listens for
  completion events over a realtime channel.

## Open Questions

- **Polling interval default.** 5 minutes is a guess. The existing
  dashboard polling defaults to 0 (off) and lets the user opt in to
  5/10/15/30 min in Settings. Should the per-entry poll share the
  same `pollingIntervalMinutes` setting, or have its own?
  *Default: share. Single polling knob is simpler, and the cache
  makes 5-min polling cheap for both.*
- **Pending-tab ordering for past-start-time entries.** The "Đang quá
  giờ bắt đầu" subtle state is a UI detail; needs design treatment
  in the watchlist sidebar. Out of scope for this ADR.
- **Cross-sport batch ordering.** Scheduled batches that mix sports
  (e.g. "generate reports for these 3 matches: 1 tennis, 2 football")
  are processed in start-time order per ADR 0001. The batch UI's
  "fireAt" picker doesn't currently distinguish sport; mixed-sport
  batches are an emergent property of the merge, not a new feature.
  *Default: no UI change needed; existing runner handles it.*
