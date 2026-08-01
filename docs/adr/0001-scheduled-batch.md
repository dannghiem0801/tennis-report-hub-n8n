# Scheduled batch — entity, trigger model, and safety-net scope

**Status**: accepted

The Tennis Report Hub introduces user-scheduled report generation. The design
splits scheduling state into a dedicated `ScheduledBatch` entity (rather than
attaching `scheduledAt` to `WatchlistEntry`), fires the batch via both
`setTimeout` and polling as belt-and-suspenders, and deliberately scopes the
scheduled trigger to **safety-net force-writes for completed matches only** —
not snapshot generation for in-progress matches. The trigger runs in strict
serial so the LLM never sees more than one in-flight request at a time.

## Context

Users add not-yet-ended matches to the watchlist and want assurance that, by
some deadline, every match that has ended in their batch has a report. The
existing `auto-on-completion` trigger already covers the happy path, but it
can fail silently (LLM timeout, exhausted retries, polling miss) and leave
completed matches without a Report. We need a user-controlled deadline
mechanism that catches those misses without duplicating the auto-on-completion
path.

## Decision

1. **`ScheduledBatch` is a separate entity**, not a field on `WatchlistEntry`.
   One batch has one `fireAt` and references a list of `watchlistEntryIds`. A
   `WatchlistEntry` gains an optional `batchId` link.

2. **The scheduled trigger at `fireAt` is scope-limited**: it processes only
   entries that are `completed` AND have no `Report` yet. Entries still
   `scheduled` or `live` at `fireAt` are **skipped** — no partial snapshot,
   no preview. They remain in the watchlist for `auto-on-completion` to
   handle when they end. Retired matches ARE processed (data is real, just
   an unusual ending), with the Report instructed to surface the retirement
   reason. Cancelled / walkover entries are skipped (no real play data).

3. **Execution is strict serial**, one WatchlistEntry fully completed (Report
   stored) before the next one starts. Failed LLM calls retry 1–2 times
   inline, then the entry is marked `failed` and the batch continues with
   the next entry.

4. **Firing is dual-mechanism**: a `setTimeout` scheduled for `fireAt - now`
   on batch creation provides precision when the tab is active, and the
   existing 10-minute polling loop provides a backup for backgrounded or
   throttled tabs. An atomic `status: "pending" → "running"` claim prevents
   double-fires.

5. **Tab close loses the schedule**. The user is informed via in-app
   documentation; no service worker, no notification fallback. This is a v1
   constraint; the v2 Supabase backend will move the trigger server-side.

6. **Batch editing is open before `fireAt`**: the user can change `fireAt`,
   add or remove entries, or cancel the whole batch. After `fireAt`, the
   batch is read-only and shows its `Batch summary`.

## Considered Options

- **Per-entry `scheduledAt` on `WatchlistEntry`** (instead of a separate
  `ScheduledBatch` entity). Rejected because the user model is "one time
  for many matches" — a batch — and per-entry storage splits the cohesive
  unit across rows. Editing `fireAt` would require N updates; cancelling a
  batch would require N deletes. A separate entity captures the
  user-intended shape directly.

- **Snapshot live matches at `fireAt`** (write a partial report for
  in-progress matches using whatever data is available at that moment).
  Originally proposed, then rejected during design review. The risk was
  the LLM producing "Sinner thắng 6-4 3-2 ret." for a match still in set
  2 — wrong semantic, low news value before the match ends, and would
  require a new `mode: "live"` template kind plus prompt engineering to
  avoid the bad outputs. Simpler and more honest to let
  `auto-on-completion` produce the real report when the match ends, and
  keep the scheduled trigger narrowly focused on safety-net retries.

- **Add a new `mode: "live"` template for live snapshots** (paired with
  the rejected snapshot option above). Rejected as a consequence — no
  live snapshots means no live template.

- **Parallel LLM calls within a batch** (back-to-back dispatches, let
  the user see reports as they finish). Rejected because the LLM API
  is the bottleneck and rate-limit sensitive; strict serial guarantees
  one in-flight request, no bursts, and predictable total time
  (`N × ~15-20s`).

- **setTimeout alone, no polling backup** (rely on browser precision).
  Rejected because Chrome and Firefox throttle backgrounded `setTimeout`
  by up to a minute, and Safari is worse. Two-tier firing is cheap
  insurance.

- **Polling alone, no setTimeout** (rely on the 10-minute polling tick
  to fire batches). Rejected because a batch set for 18:00 could fire as
  late as 18:09 if the previous poll was 17:53 — sloppy for a
  user-declared "I want reports by 18:00" intent.

- **Service Worker + Background Sync** (run batches even with the tab
  closed). Rejected for v1 because it adds a new deployment target
  (service worker registration), browser-support variance (Safari is
  limited), and undermines the v1 philosophy of simple localStorage.
  Deferred to v2 when the Supabase backend provides a server-side
  trigger.

- **Hard-lock the batch after creation** (no editing). Rejected because
  real reporters need to push `fireAt` back when editorial deadlines
  shift, or pull matches out of a batch when coverage plans change.
  Edit-before-`fireAt` matches their workflow.

- **Skip the feature entirely** and rely on `auto-on-completion` alone.
  Rejected because `auto-on-completion` has known failure modes
  (LLM timeout, exhausted retries, polling miss) and users have no
  manual deadline. The safety-net pattern is cheap insurance.

## Consequences

- **New persistence keys** in the existing localStorage layer:
  `tennis-hub.scheduledBatches` and a `batchId` field added to each
  `WatchlistEntry`. Migration on first load is additive — no data loss
  for users without batches.

- **New UI surfaces**: a "Scheduled" section in the watchlist sidebar
  (or a tab), a "Schedule batch" action on the dashboard match rows,
  a corner progress widget during execution, and a `Batch summary`
  view after `fireAt`.

- **New trigger source for `Report`**: the `triggeredBy` enum gains
  `"scheduled-batch"` alongside `"auto-on-completion"`. Filter on the
  Reports page can highlight safety-net writes for editorial review.

- **Polling loop becomes dual-purpose**: existing 10-minute poll now
  also scans for `ScheduledBatch` with `fireAt <= now && status ===
  "pending"`. The polling-driven batch fire is idempotent thanks to the
  atomic `pending → running` claim.

- **No new external service**: feature is entirely client-side and
  uses the existing OpenAI-compatible LLM config in `Settings`.

- **v2 migration is clean**: when the Supabase backend lands, the
  `ScheduledBatch` table maps directly to a Postgres table, and the
  trigger moves from `setTimeout + polling` to a server-side cron. The
  client just listens for completion events.

- **Constraint documented in-app**: users see "Giữ tab mở để schedule
  chạy" on the schedule creation flow. Closing the tab loses any
  pending batch; no recovery in v1.
