# Project Overview & PDR — Tennis Report Hub

> Product Development Requirements for the Vietnamese tennis reporting dashboard.

## 1. One-liner

Tennis Report Hub is a daily-match dashboard for Vietnamese sports journalists. It tracks tennis fixtures in one place, lets reporters "star" matches to follow, and automatically drafts a 200–400 word Vietnamese recap the moment a watched match finishes.

## 2. Problem statement

Vietnamese sports journalists covering international tennis currently stitch together their workflow across at least four surfaces:

- A live-score site (Flashscore, SofaScore) to follow scores
- The tour's official site or Wikipedia for player context
- A notes app to draft the recap
- A CMS / email to publish

The glue is manual. Recaps are written from memory minutes after the final point, with risk of mis-stating set scores, ace counts, or break-point conversions. For matches in distant time zones (Miami, Indian Wells, Phoenix) the turnaround window is also tight.

**Tennis Report Hub compresses that workflow into one tab**: see today's schedule, star the matches you want, and have a Vietnamese draft waiting for you the second the match ends.

## 3. Target user

| Persona            | Need                                                                  | How the app serves it                                  |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------ |
| Tennis beat reporter | Daily match list, one-click recaps, no factual drift                  | Dashboard + auto-draft + edit-in-place report viewer   |
| Sports editor       | Manage reporter-style templates, control polling cadence              | Templates CRUD + Settings                              |
| Casual tennis fan (VN) | "Show me today's tennis" in Vietnamese                               | Read-only dashboard, Vietnamese-first UI               |

Primary persona: tennis beat reporter working in Vietnam time (UTC+7) who covers ATP/WTA main tour.

## 4. Goals (v1)

- **G1** — Render one screen with all of today's matches, grouped by tournament, with live / scheduled / completed state visible at a glance.
- **G2** — Let the user "star" a match; from that moment the system watches the match's status and triggers a Vietnamese draft when `status === "completed"`.
- **G3** — Generate a 200–400 word Vietnamese recap from match data using a configurable template (Mặc định / Ngắn gọn / Kịch tính).
- **G4** — Persist watchlist, generated reports, custom templates, and settings in the browser so a refresh does not lose work.
- **G5** — Keep the UI 100% Vietnamese and optimized for late-night work (dark theme, low-glare palette).
- **G6** — Ship as a static SPA with no backend dependency in v1.

## 5. Non-goals (v1)

- Real tennis API integration (RapidAPI key is collected in Settings but not yet wired up).
- Authentication / multi-user.
- Sports other than tennis (Bóng đá, Bóng rổ shown as "Coming Soon" placeholders only).
- Server-side persistence.
- Export to Google Docs, email delivery.
- Background polling that survives the tab being closed (browser tab must be open).

## 6. Success criteria

| Metric                                | Target                                          |
| ------------------------------------- | ----------------------------------------------- |
| Time to first paint of dashboard      | < 1.5 s on a fresh load (local)                |
| Draft availability after match ends   | Within one polling cycle (default 5 min)       |
| Draft factual accuracy                | Zero set-score / ace-count errors vs source     |
| User edits needed before publish      | ≤ 2 light edits for a 200–400 word draft       |
| Bundle size (gzipped)                 | < 300 KB                                        |
| Vietnamese copy coverage              | 100% of user-visible strings                   |

## 7. Constraints

- **C1 — Local-only data**: All user data (watchlist, reports, templates, settings) lives in `localStorage` in v1. No server. Migration to Supabase is planned for v2 (see `project-roadmap.md`).
- **C2 — Sample data as source of truth (v1)**: The match data shown in v1 is a hard-coded fixture list in `src/data/sample-data.ts`. Real RapidAPI integration is the v2 milestone.
- **C3 — Dark theme only**: The app ships one theme. Light mode is not in scope.
- **C4 — Vietnamese first**: No English fallback. All copy is written in Vietnamese (`vi-VN` locale).
- **C5 — Modern evergreen browsers**: Targets Chromium / Firefox / Safari current-2. No IE / legacy polyfills.

## 8. User journeys

### J1 — Daily coverage workflow

1. Reporter opens the app → land on `/` (Dashboard) for today.
2. Sees 3 tournaments (Indian Wells, Miami, Phoenix) with matches grouped.
3. Stars 2 matches she wants to recap (`MatchRow` → `toggleWatchlist`).
4. Returns to work. App keeps polling every 5 min.
5. At 04:30 local, a watched match completes. The next poll picks up `status: "completed"`, kicks off report generation, and the report appears in the Watchlist sidebar ("Đã viết" tab) and on `/reports`.
6. Reporter opens the report, edits two lines, copies to clipboard, pastes into the CMS.

### J2 — Custom voice / template management

1. Reporter goes to `/templates`, clicks "Tạo mẫu mới".
2. Writes a new template using placeholders (`{player1Full}`, `{score}`, `{setNarrative}`).
3. Marks it as default.
4. The next auto-draft uses her template instead of the built-in "Tennis Recap (Mặc định)".

### J3 — Adjust polling cadence

1. Reporter goes to `/settings`.
2. Sets polling interval to 1 min for a high-traffic tournament day.
3. Saves; `app-store` rebuilds the `setInterval` with the new value.

## 9. Open questions

- **Q1** — When the real RapidAPI integration lands, do we keep the simulator behind a flag for offline demos, or drop it? (Owner: TBD)
- **Q2** — Should the polling tab-survive via a Service Worker in v2, or is "keep the tab open" acceptable for journalists at their desk? (Owner: TBD)
- **Q3** — What is the failure mode for a partial match (retired / walkover)? The current `getMatchWinner` returns `null` in those cases, which already produces a title-less, narrative-less draft — but the UX of "report failed" is not yet designed. (Owner: TBD)

## 10. References

- README.md — runtime / dev quickstart
- `codebase-summary.md` — what is in the repo
- `system-architecture.md` — how the pieces fit
- `project-roadmap.md` — what is next
