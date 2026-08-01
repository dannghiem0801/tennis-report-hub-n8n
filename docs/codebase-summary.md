# Codebase Summary — Tennis Report Hub

> What is actually in the repository, in numbers and one-liners.

## 1. At a glance

| Metric                | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| Total project LOC     | ~12,662 lines (including `package-lock.json`)            |
| Source LOC (`src/`)   | 3,768 lines across 27 TypeScript / CSS files            |
| Routes                | 4 (`/`, `/reports`, `/templates`, `/settings`)           |
| Persistent entities   | 5 (watchlist, reports, templates, settings, seenReports) |
| UI primitives         | 13 shadcn-style components                               |
| Sample matches        | 13 across 3 tournaments (1 ATP Masters, 1 WTA 1000, 1 ATP Challenger) |
| Sample players        | 26 real-tour names with country / ranking / seed         |
| Default report templates | 3 (Mặc định, Ngắn gọn, Kịch tính)                    |
| External runtime deps | 17                                                       |
| Build tool            | Vite 8 (React + Tailwind v4 plugin)                      |

## 2. Tech stack

### Runtime

- **React 19.2** + **React DOM 19.2** (function components, hooks only — no class components)
- **TypeScript ~6.0.2** (`target: es2023`, `module: esnext`, `jsx: react-jsx`)
- **React Router DOM 7.18** — 4 client-side routes
- **Tailwind CSS 4.3** (CSS-first config via `@theme inline` in `index.css`)
- **shadcn/ui-style primitives** built on **Radix UI** (Dialog, Label, Select, Slot, Tabs)
- **Lucide React 1.28** — icon set
- **Sonner 2.0** — toast notifications (bottom-right, dark theme)
- **date-fns 4.4** — included in deps; not yet consumed in source
- **zod 4.4** — included in deps; not yet consumed in source
- **react-hook-form 7.83** — included in deps; not yet consumed in source
- **class-variance-authority**, **clsx**, **tailwind-merge** — `cn()` helper

### Dev

- **Vite 8.2** — build / dev server
- **@vitejs/plugin-react 6.0**
- **oxlint 1.75** — minimal rules: `react/rules-of-hooks` (error), `react/only-export-components` (warn)
- **@types/node 24.13** for Vite config

## 3. Directory map

```
tennis-report-hub/
├── index.html                         # Vite entry, Inter font preconnect
├── package.json                       # 17 runtime + 6 dev deps
├── tsconfig.app.json                  # App TS config (target es2023, bundler resolution)
├── tsconfig.json / tsconfig.node.json # References + Node TS config
├── vite.config.ts                     # React + Tailwind v4 plugin, @/ → src/
├── .oxlintrc.json                     # React + TS + oxc plugins
├── public/                            # favicon.svg, icons.svg
├── src/
│   ├── main.tsx                       # createRoot bootstrap, StrictMode
│   ├── App.tsx                        # Router + AppProvider + TopBar + Toaster
│   ├── index.css                      # Tailwind v4 @theme, scrollbar, pulse-dot, fade-in
│   ├── types/index.ts                 # 12 exported TS types
│   ├── lib/
│   │   ├── utils.ts                   # cn(), date helpers, uid, vi-VN formatters
│   │   └── format-helpers.ts          # formatFinalScore()
│   ├── data/
│   │   └── sample-data.ts             # 26 players + 3 tournaments + 13 matches
│   ├── store/
│   │   ├── app-store.tsx              # AppContext, useApp, polling, auto-gen
│   │   └── persistence.ts             # localStorage adapter (Supabase-shaped API)
│   ├── reports/
│   │   ├── generate.ts                # Narrative engine, title, fillTemplate
│   │   └── templates.ts               # 3 default templates
│   ├── components/
│   │   ├── ui/                        # 13 primitives (Button, Card, Dialog, etc.)
│   │   ├── layout/top-bar.tsx         # Sports selector + date nav + nav
│   │   ├── dashboard/
│   │   │   ├── tournament-browser.tsx # Groups matches by tournament
│   │   │   ├── tournament-card.tsx    # Expand/collapse per tournament
│   │   │   └── match-row.tsx          # Single match row + watchlist star
│   │   ├── watchlist/
│   │   │   └── watchlist-sidebar.tsx  # 2 tabs (Đang chờ / Đã viết)
│   │   └── reports/
│   │       └── report-viewer.tsx      # Modal: view + edit + copy report
│   └── pages/
│       ├── dashboard-page.tsx         # 2-col grid: browser + sidebar
│       ├── reports-page.tsx           # History with search/filter/sort
│       ├── templates-page.tsx         # Template CRUD
│       └── settings-page.tsx          # API key, polling, TZ, notifications
└── docs/                              # This directory
```

## 4. File sizes (top 20)

| LOC  | File                                                | Role                  |
| ---- | --------------------------------------------------- | --------------------- |
| 460  | `src/data/sample-data.ts`                           | Fixture data          |
| 314  | `src/store/app-store.tsx`                           | State + orchestration |
| 253  | `src/components/watchlist/watchlist-sidebar.tsx`    | Sidebar UI            |
| 250  | `src/pages/settings-page.tsx`                       | Settings UI           |
| 243  | `src/reports/generate.ts`                           | Recap engine          |
| 239  | `src/pages/templates-page.tsx`                      | Template CRUD UI      |
| 219  | `src/pages/reports-page.tsx`                        | Report history UI     |
| 193  | `src/components/dashboard/match-row.tsx`            | Match row UI          |
| 172  | `src/components/reports/report-viewer.tsx`          | Report modal          |
| 154  | `src/components/ui/select.tsx`                      | Select primitive      |
| 134  | `src/components/layout/top-bar.tsx`                 | App header            |
| 117  | `src/types/index.ts`                                | Type definitions      |
| 107  | `src/components/ui/dialog.tsx`                      | Dialog primitive      |
| 95   | `src/components/dashboard/tournament-card.tsx`      | Tournament accordion  |
| 93   | `src/components/dashboard/tournament-browser.tsx`   | Tournament list       |
| 81   | `src/store/persistence.ts`                          | localStorage adapter  |
| 72   | `src/components/ui/card.tsx`                        | Card primitive        |
| 69   | `src/reports/templates.ts`                          | Default templates     |
| 63   | `src/components/ui/button.tsx`                      | Button primitive      |
| 61   | `src/lib/utils.ts`                                  | Helpers               |

## 5. Module dependency graph (high level)

```
App.tsx
  └── AppProvider (store/app-store)
        ├── persistence  (store/persistence)
        ├── generate     (reports/generate)
        │     └── templates (reports/templates)
        └── sample-data  (data/sample-data)

App.tsx
  └── Router
        ├── DashboardPage
        │     ├── TournamentBrowser
        │     │     └── TournamentCard
        │     │           └── MatchRow
        │     ├── WatchlistSidebar
        │     └── ReportViewer
        ├── ReportsPage
        │     └── ReportViewer
        ├── TemplatesPage
        └── SettingsPage
```

There are no circular dependencies. The store is a leaf consumer of the report engine; pages are leaves of both the store and the UI components.

## 6. State management topology

- **One** `AppContext` lives at the top of the tree (`AppProvider` in `App.tsx`).
- All state is `useState` / `useReducer` inside the provider; no external state library.
- Five `useEffect` hooks in the provider cover:
  1. Hydration from `localStorage`
  2. Persistence (5 effects — one per store slice)
  3. Initial fetch on `selectedDate` change
  4. Polling interval setup/teardown
  5. Watchlist → match-completion transition
  6. Report generation for newly-completed matches
- `useApp()` is the only consumer hook. Throws if used outside the provider.

## 7. Persistence layer

`store/persistence.ts` is a single object with `getX` / `setX` pairs over five localStorage keys:

| Key              | Type                  | Default                                        |
| ---------------- | --------------------- | ---------------------------------------------- |
| `trh:watchlist`  | `WatchlistEntry[]`    | `[]`                                           |
| `trh:reports`    | `Report[]`            | `[]`                                           |
| `trh:templates`  | `ReportTemplate[]`    | Seeded from `DEFAULT_TEMPLATES` on first run   |
| `trh:settings`   | `Settings`            | `{ rapidApiKey: "", pollingIntervalMinutes: 5, defaultTemplateId: "tpl-default", timezone: "Asia/Ho_Chi_Minh", notificationsEnabled: true }` |
| `trh:seenReports`| `string[]`            | `[]`                                           |

The file's leading comment notes this is the abstraction layer to swap for Supabase in v2 — only this file needs to change.

## 8. Conventions in one breath

- Path alias: `@/*` → `./src/*` (TS + Vite agree).
- Files: lowercase with hyphens (`match-row.tsx`, `app-store.tsx`).
- Components: PascalCase function exports, default-named module.
- One component per file (except the small `Stat` helper in `settings-page.tsx`).
- Tailwind for everything; no inline styles except in the Toaster config.
- Vietnamese copy is written, not auto-translated.

## 9. What's not in the repo

- No tests (no `__tests__/`, no `*.test.*`, no test runner in `package.json`).
- No CI configuration (no `.github/`, no `netlify.toml`).
- No environment variable file / no `.env*` (the `rapidApiKey` lives in `localStorage`).
- No Storybook / design system docs beyond this `docs/` directory.
- No backend — this is a static SPA.
- No real network calls; `fetchMatches` simulates 600ms latency and returns the sample fixture.

## 10. See also

- `code-standards.md` — the actual coding rules
- `system-architecture.md` — runtime architecture
- `design-guidelines.md` — visual system
- `deployment-guide.md` — how to ship
