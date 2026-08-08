# Glossary

Terms that have specific meaning in the Tennis Report Hub codebase. New
terms introduced by [ADR 0003 — Unified watchlist](./adr/0003-unified-watchlist.md)
are marked **(new in 0003)**. Terms retired by 0003 are marked
**(retired in 0003)**.

---

## Active sport

The sport the user is currently browsing on the dashboard. Controls
which sport's fixtures are fetched and displayed in the tournament
browser. **(0003):** Active sport is now a *dashboard filter*, not a
data partition. The watchlist, reports, and scheduled batches are
sport-agnostic and do not swap on `setActiveSport`.

## Auto-on-completion

The report-generation pipeline that fires when a watchlist entry's
match transitions to `completed`. Walks the entry through
`fetching-pbp` → `building-context` → `web-searching` →
`consolidating` → `completed` states and produces a `Report`. **(0003):**
Now fires regardless of which sport tab is open. Cross-sport entries
are detected via the per-entry poll, not the dashboard `matches`
array.

## Dashboard fast-path **(new in 0003)**

The existing pipeline path that uses the dashboard's `matches` array
to detect completions (`app-store.tsx:570-598`). When the user is
browsing a sport and a watchlist entry's match is in the current
fetch results, this path fires immediately. The per-entry poll is the
*fallback* for cross-sport entries, not a replacement for this path.

## Group-by-sport rendering **(new in 0003)**

The watchlist sidebar's new visual structure: within each top-level
tab (`Đang chờ` / `Đã viết`), entries are grouped under collapsible
per-sport section headers (`🎾 Tennis (3)`, `⚽ Football (2)`), each
section sorted by start time. Empty sport sections are hidden.

## Per-entry poll **(new in 0003)**

A background timer registered per pending `WatchlistEntry` that
periodically checks the entry's match status via the upstream API.
~1 API call per pending entry per poll cycle; cached responses are
free. Created on `addToWatchlist`, torn down when the entry leaves
`pending`. Lives alongside the dashboard fast-path as the
cross-sport completion detector.

## Per-sport partition **(retired in 0003)**

The implicit architectural pattern where the user's
`WatchlistEntry[]` / `Report[]` / `ScheduledBatch[]` collections
were split per sport, with `setActiveSport` swapping the in-memory
state when the user toggled sports. Replaced by the unified
sport-agnostic model. The storage layer was already sport-agnostic
(one localStorage key per collection); the partition lived only in
the in-memory read path.

## Per-sport storage

Storage keys that hold data for one specific sport. Used for
`ReportTemplate[]` only — templates are sport-specific configuration
(templates encode sport-specific prompt structure: tennis aces,
football possession). Templates do not travel across sports and
retain their per-sport keys (`trh:templates` already holds all sports'
templates in a single array, but the read path filters to the active
sport).

## Scheduled batch

A user-created deadline (`fireAt`) for a set of watchlist entries
whose reports should be force-written by that time. The batch
runner processes only `completed` entries at `fireAt`; pending or
live entries are skipped and left for `auto-on-completion`. See
[ADR 0001](./adr/0001-scheduled-batch.md). **(0003):** Batches can
now mix sports. Existing per-batch UI handles this without changes.

## Sport-agnostic storage

Storage keys that hold data for all sports in a single collection,
with each item tagged by its `sport` field. Used for
`WatchlistEntry[]` (`trh:watchlist`), `Report[]` (`trh:reports`),
`ScheduledBatch[]` (`trh:scheduledBatches`), and the
"new report" badge tracking (`trh:seenReports`). **(0003):** These
keys were already sport-agnostic at the storage layer; the read path
now matches.

## Unified watchlist **(new in 0003)**

The single sport-agnostic `WatchlistEntry[]` that holds the user's
curated matches across all sports. Replaces the implicit
per-sport watchlist partition. The dashboard remains per-sport for
browsing, but the watchlist itself is one list.

## Watchlist status

The lifecycle state of a `WatchlistEntry`:
`pending` → `fetching-pbp` → `building-context` → `web-searching` →
`consolidating` → `completed` (or `failed`). The dashboard fast-path
and per-entry poll both move entries out of `pending` when their
match ends; the rest of the pipeline is shared.
