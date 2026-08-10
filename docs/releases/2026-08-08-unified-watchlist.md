# Release: Unified sport-agnostic watchlist

**Date:** 2026-08-08
**Branch:** `feat/auto-20260808-unified-watchlist-v2` → `main` (merged at `9a01bad`)
**Follow-up:** `eff256e` (pre-existing TS errors blocking `npm run build`)
**Live URL:** https://tennis-report-hub.vercel.app
**ADR:** [0003 — Unified watchlist](../adr/0003-unified-watchlist.md) · [Glossary](../glossary.md)

## What shipped

The watchlist, report history, and scheduled-batches collections are now **unified across all sports** — Tennis 🎾 and Football ⚽ entries live in a single sport-agnostic list, grouped by sport inside the sidebar. The active sport is now strictly a **dashboard filter** (which fixtures the tournament browser shows); it no longer partitions the user's curated state.

### User-visible changes

- **Watchlist sidebar**
  - Pending and Completed tabs each render collapsible per-sport sections (🎾 Tennis (n), ⚽ Football (n))
  - Each section sorts by start time (ascending for pending — next match first; descending for completed — most recent first)
  - Per-row sport chip on every entry, visible even when a section is collapsed
  - Empty sport sections are hidden
- **Top-bar sport switcher**
  - Tennis 🎾 and Football ⚽ are both live; Basketball 🏀 stays "Soon"
  - Switching sport only re-fetches dashboard fixtures — watchlist / reports / batches stay put
- **Dashboard**
  - Header copy follows the active sport ("Lịch thi đấu tennis hôm nay" vs "Lịch thi đấu bóng đá hôm nay")
  - Error banner uses the sport-aware API label ("Tennis API" vs "Sports API")
  - Order on small screens preserved (watchlist above matches on `<lg`)

### Engineering changes

- **Per-entry background poll** (batched by `(sport, date)`, 30-min cache dedupes). Detects cross-sport match completion regardless of which tab the user has open. ~3 API calls/cycle for 10 entries across 3 dates, not 10.
- **Unified storage accessors** (`getUnifiedWatchlist` / `setUnifiedWatchlist` etc.) in `persistence.ts` aggregate per-sport localStorage keys at the AppState level. Per-sport storage and migration logic are preserved verbatim — zero data loss for existing users.
- **`setActiveSport` no longer swaps** the unified collections. Only templates (still per-sport) reload.
- `tsc -b` now passes (was 78 errors on broken `main` before the merge; 0 after).
- `vite build` clean (616KB minified, 190KB gzipped).

## Why this is on `main` now

The user-perceived "2 watchlists" was a consequence of an **architectural intent** in `app-store.tsx`'s `setActiveSport` that swapped the watchlist / reports / batches in-memory on sport change. The intent never matched the storage layer (which was already sport-agnostic on plain keys) and it never matched the data model (where each `WatchlistEntry` carries its own `sport` field). The unification is at the AppState boundary, not the storage boundary.

## Commits in this release

| SHA | Subject |
|---|---|
| `98faa9d` | build: add .vercelignore to exclude worktrees from Vercel build |
| `f1660ed` | fix(match-row): branch on match.sport so football rows render |
| `ef91f28` | fix(mapper): sport-aware mapping + build proper FootballMatch shape |
| `6bddf9b` | feat(football): app-side pre-fetch of web sources via Firecrawl |
| `6f11e9c` | fix(football): strengthen tool-use language to ALL CAPS / BƯỚC ĐẦU TIÊN |
| `4b12e1e` | fix(football): make web_search + scrape_url mandatory first steps |
| `435a43c` | fix(football): drop analysis block + 3-step structure from prompt |
| `37a9716` | fix(football): tighten prompt to keep analysis + report in one response |
| `22203f5` | feat(football): add default LLM prompt template for football recap (v1.5) |
| `42715d1` | fix(llm): route browser calls through Vercel serverless proxy to bypass CORS |
| `b6ddf9b` | (other multi-sport refactor commits — see `git log eff256e` for the full list) |
| `a8feee1` | feat(watchlist): unified sport-agnostic view on top of per-sport storage (ADR 0003) |
| `9a01bad` | Merge feat/auto-20260808-unified-watchlist-v2 into main |
| `eff256e` | fix(mapper): drop unused ScoreLine and MatchStats type imports |

## Known v1 trade-offs

- **Up to 30-min detection lag for cross-sport entries.** The 30-min `TTL.listByDate` cache means a freshly-completed cross-sport match may still be reported as "live" in cached responses for up to 30 minutes. The dashboard fast-path is unaffected (its `fetchMatches` call always re-fetches). Acceptable for v1; fix is a per-entry cache bust for entries whose `startTime + buffer` has passed.
- **Templates stay per-sport.** A tennis template does not appear in the football template picker. This is by design (sport-specific prompt structure) and matches the ADR.
- **Sport enum duplicated in 5 places** (`top-bar.tsx`, `watchlist-sidebar.tsx`, `persistence.ts`, `templates.ts`, `app-store.tsx`). Refactor to a single `src/lib/sports.ts` module is a known follow-up.

## How to verify

1. Open https://tennis-report-hub.vercel.app
2. Click ⚽ Football in the top bar — dashboard switches to football fixtures
3. Add a football match to the watchlist
4. Switch back to 🎾 Tennis
5. Confirm the football entry appears in the watchlist sidebar under "⚽ Bóng đá (1)"
6. Collapse the Bóng đá section — entry hides, click again to expand
7. Trigger a report generation for any entry — should fire regardless of which sport tab is open

## Cleanup

Stale branches deleted locally and on remote:
- `feat/auto-20260808-e316835e` (broken-base attempt — abandoned, had the `vercel.json` workaround)
- `feat/auto-20260808-unified-watchlist-v2` (merged into main; the one that worked)
