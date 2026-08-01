# Project Roadmap — Tennis Report Hub

> Where the product is, where it's going, and the open questions between.

## 1. Where we are (v1.0.0)

Status: **shippable for single-user, single-browser use.**

- [x] Sports selector with "Coming Soon" badge for non-tennis sports
- [x] Tournament browser with expand / collapse
- [x] Watchlist sidebar (2 tabs: Đang chờ / Đã viết)
- [x] Auto report generation when a watched match becomes `completed`
- [x] Report viewer modal with edit + copy
- [x] Report history with search / filter / sort
- [x] Template management (CRUD + set default)
- [x] Settings: API key, polling interval, timezone, notifications toggle
- [x] Polling every 5 min (configurable 1 / 5 / 10 / 15 / 30)
- [x] Vietnamese UI 100%
- [x] Responsive mobile (basic)
- [x] Dark theme only

What v1 deliberately is **not**:

- No real tennis API. Sample fixtures only.
- No backend. `localStorage` is the only store.
- No auth. Single-user, single-device.
- No background polling outside the open tab.
- No automated tests.

## 2. v1.x — small upgrades (incremental, no schema break)

These are quality-of-life and Polish-on-what-exists tasks. Each fits in a single PR.

| Ticket | Title | Why now | Touches |
| ------ | ----- | ------- | ------- |
| V1-1  | Loading skeletons for reports list | Currently the empty state is a hard "no reports yet"; show a skeleton during initial fetch | `reports-page.tsx` |
| V1-2  | Mark "Mới" badge persistence across sessions | Already wired through `seenReportIds`; verify the badge clears correctly on read | `report-viewer.tsx`, `reports-page.tsx` |
| V1-3  | Add keyboard shortcut for date stepping (← / →) | Top-bar date nav is click-only; power users want keys | `top-bar.tsx` |
| V1-4  | "Mở báo cáo" from the dashboard sidebar opens the modal | Already implemented; verify cross-page navigation | `dashboard-page.tsx`, `watchlist-sidebar.tsx` |
| V1-5  | Print stylesheet for a single report | Reporters often paste to CMS; printing is a fallback path | `report-viewer.tsx`, `index.css` |
| V1-6  | Add a fourth default template: "Phỏng vấn ngắn" (Q&A style) | Variety in voice without user effort | `templates.ts` |
| V1-7  | Add a fifth default template: "Statistical Recap" (numbers-first) | Useful for analytics-leaning outlets | `templates.ts` |
| V1-8  | Surface Polling interval in minutes on the dashboard header | Discoverability — currently buried in settings | `dashboard-page.tsx` |
| V1-9  | Add a "test fixtures" toggle in Settings (force a `live` match to flip `completed` next tick) | Lets the user demo the auto-gen flow on demand | `settings-page.tsx`, `app-store.tsx` |
| V1-10 | Add Open Graph + Twitter card metadata for `/` | Better link previews when sharing the dashboard | `index.html` |

## 3. v2.0 — the platform upgrade (schema break, planned)

These need coordinated work; the headline item is replacing `localStorage` with Supabase.

| Ticket | Title | Why | Touches |
| ------ | ----- | --- | ------- |
| V2-1  | **Replace `localStorage` with Supabase** | Cross-device, multi-reporter, no data loss on browser change | `persistence.ts`, `app-store.tsx` |
| V2-2  | **Wire real RapidAPI tennis endpoint** | Real fixtures, real scores, real status transitions | `app-store.tsx.fetchMatches`, new `services/tennis-api.ts` |
| V2-3  | **Auth (email magic link via Supabase Auth)** | Multi-reporter teams; per-user watchlist and reports | new `pages/auth/*`, `app-store.tsx` |
| V2-4  | **Server-side background polling via Supabase Edge Function** | Matches can be detected as completed even when the user's tab is closed | new `supabase/functions/poll-tennis/` |
| V2-5  | **Email digest on watchlist completion** | Reporter gets a 7am digest of yesterday's drafted reports | new `supabase/functions/digest/`, `app-store.tsx` |
| V2-6  | **Export to Google Docs** | Direct handoff to a CMS-less workflow | new `services/google-docs.ts` |
| V2-7  | **Multi-sport: Bóng đá, Bóng rổ** | The "Coming Soon" pills in the top bar become real | `types/index.ts`, `data/`, components |
| V2-8  | **LLM-assisted report rewrite (optional)** | For outlets that want a less templated voice; the deterministic engine stays as a fallback | new `services/llm-rewrite.ts` |

### 3.1 Migration plan: localStorage → Supabase

The `store/persistence.ts` module is the seam. It is shaped as 5 read / 5 write pairs that hide their backend. The migration is:

1. **Land the Supabase client in `services/supabase.ts`**. Keep `persistence.ts` as the public API.
2. **Add an async path** alongside the sync one: `getWatchlistAsync()` / `setWatchlistAsync()`. Switch the call sites in `app-store.tsx` to the async variant. Hydration becomes `await`-able.
3. **Ship a one-shot migration** that, on first sign-in, reads the user's `localStorage` blobs and writes them to Supabase. Show a toast: "Đã đồng bộ N báo cáo vào tài khoản của bạn."
4. **Defer the `localStorage` write path** behind a `?fallback=local` query for offline development.

This ordering keeps the UI working at every step (no big-bang cutover).

## 4. v3.x — research & reach (post-platform)

| Ticket | Title | Notes |
| ------ | ----- | ----- |
| V3-1  | **Live in-match commentary (push, not poll)** | Server-Sent Events from the polling service; updates without a full refetch |
| V3-2  | **Public /shareable report URLs** | Per-report landing page; SEO-friendly for tennis blogs |
| V3-3  | **Realtime collaborative editing** | Two editors on the same report before publish |
| V3-4  | **i18n: English + Spanish** | Add a `Language` switch in Settings; rewrite copy |
| V3-5  | **Mobile native shell (Capacitor)** | Wrap the SPA; keep the same build pipeline |

## 5. Technical debt (worth filing now)

These are small but each is a future footgun.

- **`TournamentBrowser` uses `SAMPLE_TOURNAMENTS.find(...)` to enrich the API match** — fine in v1, but the day the API is wired, the API response needs to carry the tournament metadata. File: `tournament-browser.tsx:24`.
- **`uid()` is `Math.random() + Date.now()`** — collision-resistant enough for one browser; insufficient if a Supabase row ID is ever derived from it. Switch to `crypto.randomUUID()` when v2 lands.
- **The `react-hooks/exhaustive-deps` rule is not enforced** (no `eslint-plugin-react-hooks`; oxlint's `react/hooks` does not include it). The `useEffect` in the report-generation block has an `eslint-disable-next-line` for that reason. Add the rule when a real test suite lands.
- **No tests.** The state machine in `app-store.tsx` (especially the pending → generating → completed transition) is testable but un-tested.
- **`useApp` is called inside `WatchlistSidebar.PendingItem` and `.CompletedItem`** — small components, fine, but they re-render on every state change. If perf becomes a concern, split the sidebar into two separately-rendered trees with selector hooks.
- **`format-helpers.ts.formatFinalScore` is duplicated logic** with `reports/generate.ts.formatFullScore`. Keep one in `lib/format-helpers.ts` and have `generate.ts` import it.
- **`Sports` selector is a static array of literals**, not the typed `Sport` union from `types/index.ts`. Type the array as `({ id: Sport; ... })[]` so adding a sport updates both type and selector.
- **`lucide-react ^1.28.0`** is pinned to a version that may predate the icon set used here (`Sparkles`, `FileText`). Verify icons render before any major bump.

## 6. Cross-cutting concerns

| Concern          | Today's answer                                       | What needs to change for v2                                  |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| Auth             | None                                                 | Supabase Auth (magic link)                                   |
| Persistence      | localStorage                                         | Supabase Postgres                                            |
| API              | Sample fixture                                       | Real RapidAPI call in `services/tennis-api.ts`               |
| Background work  | Browser `setInterval` only                           | Supabase Edge Function cron                                  |
| Notifications    | `settings.notificationsEnabled` is read, not wired   | Wire to browser Notification API + email digest              |
| Theming          | Dark only                                            | Keep dark; light is not in scope                             |
| i18n             | Vietnamese hard-coded                                | Move copy to `messages/vi.ts`; add `messages/en.ts` in v3   |
| Tests            | None                                                 | Vitest + React Testing Library (when test infra is approved) |
| CI               | None                                                 | GitHub Actions: typecheck + build                            |
| Deploy           | Manual `npm run build`                               | GitHub Pages / Netlify / Vercel via CI                       |

## 7. Open questions (carry into the next planning round)

- **Q-A** — What is the failure mode for a partial / retired / walkover match? The current code returns `null` from `getMatchWinner`; the report's title and narrative silently degrade. Do we want a UI state for "report generation skipped" instead?
- **Q-B** — Do we ship a Service Worker in v1.x for offline tab resilience, or only at v2 with the Supabase polling move? Service Worker + Supabase Storage + IndexedDB is a bigger stack than v1 should grow into.
- **Q-C** — When a real API is wired, do we keep the sample fixture behind a `?demo=1` query for offline demo / sales use, or drop it?
- **Q-D** — "Tennis Report Hub" assumes one sport. If v2-7 lands, do we rebrand to a more generic "Daily Sports Report Hub" or keep tennis-first and add football / basketball as siblings?
- **Q-E** — How do we measure report factual accuracy at scale? Without an LLM in the loop, the only check is "do the numbers in the report match the source match object." A small post-generation verifier (numbers present? `setNarrative` not empty?) is worth scoping.

## 8. See also

- `project-overview-pdr.md` — goals and constraints
- `system-architecture.md` — where the seams are
- `code-standards.md` — what we do today
