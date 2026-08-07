# Multi-sport refactor — architecture for adding football (and future sports)

**Status**: accepted (2026-08-07)

The Tennis Report Hub becomes multi-sport in v1.5, with **football (bóng đá)** as
the first non-tennis sport to ship. The refactor re-shapes the data model into
a sport-aware discriminated union, isolates per-sport storage and template
pools, and persists the user's active sport across sessions. This ADR locks in
the eight architectural decisions made during the v1.5 design grill.

## Context

The hub was originally tennis-only: `Match` carried `player1`/`player2`, the
mapper spoke tennis vocabulary (sets, aces, break points, retired/walkover), and
the localStorage layer assumed one sport. Adding football in v1.5 was a
forcing function — the `Sport` enum already admitted `"football"` and
`"basketball"`, the TopBar already had a "Bóng đá" tab marked "Coming Soon",
and the FlashScore API client already took a `sportId` parameter. But every
other layer (types, mapper, watchlist, reports, templates, scheduled batches)
was hardcoded to tennis.

Three options were on the table:

1. **Multi-sport core refactor** (chosen) — rebuild the data model around a
   sport-aware discriminated union, with per-sport storage and templates.
2. **Fork into a new `soccer-report-hub` repo** — fastest to ship, but
   doubles every bug fix and the two codebases drift within weeks.
3. **Hybrid `if/else` branches in every component** — keeps tennis data
   model intact, but accumulates technical debt from day one.

Multi-sport refactor (option 1) was chosen because the data layer
(`flashscore.ts`) already had `sportId`, the `TopBar` already exposed a
sport selector UI, and the `Sport` type already admitted multiple values. The
domain was already multi-sport; only the implementation was tennis-shaped.

## Decision

Eight decisions were made, in order:

### 1. Scope: multi-sport core refactor (not fork, not hybrid)

The data model becomes sport-aware throughout. Tennis code is not deleted —
it's wrapped into the `TennisMatch` variant of the discriminated union and
gated by `sport === "tennis"`.

### 2. `Match` is a discriminated union by `sport`

```ts
type Match = (CommonMatchFields & TennisVariant) | (CommonMatchFields & FootballVariant);
```

Common core (`id`, `date`, `status`, `tournament`, `startTime`) is shared via
intersection. Sport-specific fields live in each variant:

- `TennisMatch` — `player1`, `player2`, `sets[]`, `stats` (aces, double
  faults, break points), `pointByPoint`.
- `FootballMatch` — `home`, `away`, `score` (goals), `events[]` (goals,
  cards, subs), `halftimeScore`, `stats` (possession, shots, corners).

Considered alternatives:

- **Core + optional extension blocks** (`match.tennis?: { ... }`) — rejected
  because the shared core would have to be redeclared per block, and
  TypeScript narrowing via `if (match.tennis)` is verbose compared to
  `if (match.sport === "tennis")`.
- **Generic `Record<string, unknown>` bag** — rejected as unsafe and
  un-discoverable.

### 3. `WatchlistEntry` is generic-shape (not discriminated)

The entry stores display labels only (`side1Name`, `side2Name`, `side1Flag`,
`side2Flag`, `tournamentName`, `tournamentCategory`, ...). It does not
re-discriminate what `Match` already discriminates. This keeps the watchlist
list-rendering code uniform across sports while `Report.match: Match`
remains the typed source of truth for sport-specific data.

### 4. `localStorage` namespace is per-sport

`tennis-hub.*` and `football-hub.*` are separate key prefixes. Migration is
trivial because the existing key is `tennis-hub.*` already — no rename
needed. Cross-sport queries ("show me everything") are not required by
v1.5 features; per-sport storage buys natural isolation without losing
future flexibility (a future "all sports" view can read N keys and merge).

Considered alternatives:

- **One shared key (`hub.*`) with `sport` field per entry** — rejected for
  v1.5 because it complicates the watchlist sidebar and the existing
  localStorage layout. Easier to merge later than to split.

### 5. Active sport state lives in localStorage + React context

`activeSport: Sport` is persisted in `hub.activeSport` (single key, not
per-sport — it identifies the user's current selection). React context
exposes it app-wide. Switching sport on the TopBar rewrites localStorage
and re-renders dashboard / watchlist / reports.

Considered alternatives:

- **URL state** (`?sport=football` or `/football/dashboard`) — more
  web-idiomatic, but requires a React Router refactor that the codebase
  doesn't need yet. Defer.
- **Session-only** — degrades UX (refresh resets selection). Rejected.

### 6. Template pool is per-sport, with `sport` field on each template

Each `ReportTemplate` carries `sport: Sport`. Tennis templates
(`tennis-hub.templates`) and football templates (`football-hub.templates`)
are separate. The `isDefault` flag is sport-scoped — each sport has exactly
one default template. Auto-on-completion looks up the default template via
`entry.sport`, not `activeSport`, so a football entry never picks up a
tennis template by mistake.

Three bundled football templates ship in v1.5: **Default** (150-300 từ,
nêu kết quả + 1-2 tình huống nổi bật), **Ngắn gọn** (80-150 từ, chỉ
tỉ số + người ghi bàn), **Kịch tính** (250-400 từ, narrative + tình huống
then chốt + bối cảnh giải). For v1.5 MVP, only the **Default** template is
shipped; Ngắn gọn and Kịch tính are user-editable in the UI and can be
cloned from Default.

### 7. v1.5 scope is MVP: just unblock the soccer tab

Per-sport template content is shipped, but advanced features (point-by-
point viewer is tennis-only by design; minute-by-minute viewer for football
is deferred) and the batch progress widget for football are out of v1.5
scope. The scheduled-batch safety-net mechanism works for football out of
the box because the entry is sport-aware — no special-casing required.

Considered alternatives:

- **Core parity** — adds point-by-point-equivalent for football, full
  scheduled-batch UI parity. Rejected for v1.5; defer to v1.6.
- **Feature parity** — every tennis feature duplicated for football.
  Rejected as scope creep; the user explicitly chose MVP.

### 8. `WatchlistEntry.player1Name` → `side1Name` (full rename, not alias)

The old field name `player1Name` is tennis-coded; for a football entry
holding `"Arsenal"`, the name is misleading. Full rename keeps the field
naming coherent with the multi-sport data model. Migration on read: legacy
localStorage entries are loaded and rewritten with the new field name on
first access (one-time, additive).

Considered alternatives:

- **Alias** (`side1Name?: string`, fall back to `player1Name`) — keeps
  backward compat but leaves two names for one concept, which is a
  long-term maintenance trap.
- **No rename** — read awkward ("`player1Name: 'Arsenal'`") and makes
  the multi-sport nature invisible in the code.

## Considered Options (consolidated)

- **Fork into `soccer-report-hub`** — rejected. Two codebases, double
  work.
- **Hybrid `if (sport === ...)` branches in every component** —
  rejected. Spaghetti from day one.
- **Core + optional extension blocks** — rejected. Verbose narrowing,
  shared core duplicated.
- **Generic `Record<string, unknown>` Match bag** — rejected. Unsafe.
- **One shared localStorage key with `sport` per entry** — rejected for
  v1.5 (deferrable, but per-sport keys buy isolation now without losing
  future merge).
- **URL state for active sport** — rejected for v1.5. Defer to v1.6+.
- **Session-only active sport** — rejected. Degrades UX.
- **Shared template pool with `sport` filter at lookup** — rejected.
  Per-sport storage matches the per-sport storage decision for the
  rest of the entities.
- **No templates (build prompts inline)** — rejected. Loses the
  customizable template UX that already exists.
- **Alias `player1Name` rather than rename** — rejected. Two names for
  one concept is a long-term trap.
- **Core parity or feature parity for v1.5 scope** — rejected. User
  chose MVP.

## Consequences

- **Match is a discriminated union** — `Report.match: Match` already
  works; consumers must switch on `match.sport` to narrow. Existing
  tennis code gets wrapped into the `TennisMatch` variant and gated by
  `sport === "tennis"`.

- **Per-sport localStorage keys** — `tennis-hub.watchlist` (existing)
  stays untouched. `football-hub.watchlist` is new. The top-level
  `hub.activeSport` key is the only single-sport key, because it stores
  the user's selection, not per-sport data.

- **TopBar sport switcher is live** — clicking "Bóng đá" rewrites
  `hub.activeSport` and re-renders dashboard, watchlist, reports,
  templates, and scheduled-batch UI to football.

- **Auto-on-completion template lookup is sport-aware** —
  `entry.sport` selects the template pool. A football entry never picks
  up a tennis template.

- **ScheduledBatch is single-sport** — the batch's `watchlistEntryIds`
  all share `sport` because the entry is sport-aware. Adding a tennis
  entry to a football batch is filtered out at add time.

- **One bundled football template ships in v1.5 MVP** — Default. User
  can clone/edit in the UI to add more variants.

- **No new external service** — same RapidAPI endpoint, same LLM config,
  same Vercel deployment. Sport switch is a client-side filter; the API
  call already takes `sportId`.

- **v1.6 migration path is clean** — when point-by-point-equivalent
  for football ships, add a `FootballMatch.footballEvents` field
  alongside `TennisMatch.pointByPoint` and the auto-on-completion pipeline
  gains a `fetching-events` state. The discriminated union makes this a
  localized change.

- **Migration on first load is additive** — existing tennis localStorage
  is read as-is. The only rewrite is the `player1Name` →
  `side1Name` rename, which happens on first watchlist read and is
  persisted back immediately. No data loss.

- **Defer to v1.6+** — point-by-point-equivalent for football, batch
  progress widget for football, basketball support, project rename
  ("Tennis Report Hub" → "Sports Report Hub"), per-sport Settings (if
  the user wants to set different polling intervals per sport).
