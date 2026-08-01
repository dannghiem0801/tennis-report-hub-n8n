# Code Standards — Tennis Report Hub

> How we write code in this repo. These are the rules the codebase actually follows today; deviating from them needs a reason.

## 1. Language & runtime

- **TypeScript** with `strict` semantics implied by `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`.
- **JSX**: `react-jsx` (no `import React` needed; the new transform).
- **Module system**: ESM only. `"type": "module"` in `package.json`. Vite handles bundling.
- **Target**: `es2023`. No legacy down-leveling.
- **Path alias**: `@/*` resolves to `./src/*` (in both `tsconfig.app.json` and `vite.config.ts` — both must agree).

## 2. File & folder naming

| Kind             | Convention                          | Example                          |
| ---------------- | ----------------------------------- | -------------------------------- |
| Page             | kebab-case + `-page.tsx`            | `dashboard-page.tsx`             |
| Component        | kebab-case + `.tsx`                 | `match-row.tsx`, `top-bar.tsx`   |
| Hook / store     | kebab-case + `.ts` or `.tsx`        | `app-store.tsx`, `persistence.ts`|
| Pure logic       | kebab-case + `.ts`                  | `generate.ts`, `format-helpers.ts`|
| Type-only module | kebab-case                          | `types/index.ts` (single barrel) |
| Docs             | kebab-case + `.md`                  | `project-overview-pdr.md`        |

Folders mirror domains: `components/dashboard/`, `components/watchlist/`, `pages/`, `store/`, `reports/`, `data/`, `lib/`, `types/`.

## 3. Component conventions

### 3.1 Exports

- **Named exports** for components (`export function MatchRow`).
- **Default export** only for the root `App` module and the store's hook (where appropriate).
- **No barrel files inside `components/`** — import directly from the leaf.

### 3.2 Definition

- **Function components only.** No `React.FC`, no class components.
- **No `React.FC<Props>` typing** — declare the props type as a plain `type` or `interface` and use it as the parameter type:

  ```tsx
  // ✅
  export function TopBar() { ... }

  interface MatchRowProps {
    match: Match;
    onToggleWatchlist: (m: Match) => void;
  }
  export function MatchRow({ match, onToggleWatchlist }: MatchRowProps) { ... }

  // ❌
  export const MatchRow: React.FC<MatchRowProps> = ({ match, onToggleWatchlist }) => { ... }
  ```

### 3.3 One component per file

Small helpers colocated with their parent are OK (e.g. `Stat` in `settings-page.tsx`, `PendingItem`/`CompletedItem`/`EmptyState` in `watchlist-sidebar.tsx`). Anything reused by another page must be lifted to its own file.

### 3.4 Hooks rules

- All `useState` / `useEffect` / `useCallback` / `useMemo` calls at the top of the function — no conditional hooks.
- `react/rules-of-hooks` is enforced as `error` in `.oxlintrc.json`.

## 4. State management

- **One provider, one hook.** The app uses a single `AppContext` and a single `useApp()` hook. Adding a second context is a code smell — prefer extending the existing `AppState` interface and adding actions to the provider.
- **Persistence is a `useEffect` per slice.** Each top-level state slice has a `useEffect(() => storage.setX(slice), [slice])` next to it. Add the slice to the same block when you add a new one.
- **Action creators are `useCallback` wrappers** around `setState`, exposed on the context value. They live next to the state they mutate; do not extract them to a separate `actions.ts`.
- **Async actions are inline `async` functions in the provider**; do not promote to a service module until the second async action appears.

## 5. TypeScript style

- **`type` over `interface`** for unions, intersections, and utility types; **`interface` over `type`** for object shapes that may be extended (e.g. component props).
- **No `any`.** Use `unknown` and narrow, or define a precise type.
- **No non-null assertions** (`!`) outside `src/main.tsx` (the `getElementById("root")!` is the one allowed case).
- **Imports**: use `import type` for type-only imports (`import type { Match } from "@/types"`). `verbatimModuleSyntax` is on, so this is enforced.
- **One type per concept.** Co-locate small types with their consumer; promote to `types/index.ts` only when used in more than one module.

## 6. Styling

- **Tailwind utility classes only.** No CSS modules, no styled-components, no `<style jsx>`.
- **`cn()` from `@/lib/utils`** for conditional classes. Never concatenate strings.
- **Design tokens via CSS variables** (defined in `src/index.css` under `@theme inline`). Tailwind maps them through v4's theme system — use the semantic class (`bg-card`, `text-muted-foreground`) rather than the raw color (`bg-slate-800`) when the semantic name exists.
- **Inline style only for the Sonner `Toaster` config** in `App.tsx`. Anywhere else, prefer a Tailwind class.
- **Animations**: declare keyframes once in `index.css` (`pulse-dot`, `fade-in`) and apply via utility class.

## 7. Vietnamese copy rules

- All user-facing strings are written in Vietnamese. No English fallback.
- Use the `vi-VN` locale for any `toLocale*` call. `formatTime` and `formatDateVi` already do this.
- Keep sentence length moderate (15–25 words for body copy). The narrative engine emits around this range.
- Avoid mixing English jargon in headlines — use established tennis terms (e.g. `break-point`, `set`, `tiebreak`, `hạt giống`, `hạng`) in their Vietnamese equivalents.

## 8. Persistence (localStorage) conventions

- All keys are prefixed with `trh:` (e.g. `trh:watchlist`). Add new keys to the `KEYS` const in `store/persistence.ts` rather than inline string literals.
- Every read path goes through the `read<T>` / `write<T>` helpers; they swallow quota and parse errors so the app does not crash on a corrupted entry.
- When you change the schema of a persisted entity, add a versioned key (`trh:reports:v2`) and a migration in the `get*` method. Do not silently drop old data on a schema break.

## 9. Linting & formatting

- **oxlint** is the only linter configured. Two rules active:
  - `react/rules-of-hooks: error`
  - `react/only-export-components: warn` (with `allowConstantExport: true`)
- **No Prettier** — formatting is by hand, matching the existing style (single quotes for TS, double quotes for JSX attributes, no semicolons in `.ts` / `.tsx` source — verified against existing files).
- **No automated tests yet** — when adding the test runner, document the choice in `project-roadmap.md` first.

## 10. Imports

- **Path alias `@/`** for any cross-module import. Relative imports (`./`, `../`) only inside the same folder.
- **Side-effect imports** (e.g. `import "./index.css"`) only in `main.tsx`.
- **Order** (manually maintained; no Prettier):
  1. External packages
  2. `@/...` alias imports
  3. Relative imports
  4. `import type` blocks (grouped with their value imports by module)

## 11. Git / commit hygiene

The repo has no commit convention yet. If you introduce one, prefer **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`) since it maps cleanly onto future changelog automation.

## 12. PR review checklist (when one is set up)

- [ ] No new `any` introduced
- [ ] No new non-null assertions outside `main.tsx`
- [ ] New `useEffect` has explicit dependency array
- [ ] New persisted key added to `KEYS` const
- [ ] Vietnamese copy proofread (not auto-translated)
- [ ] No console logs left in source
- [ ] Build passes (`npm run build`)

## 13. What is explicitly NOT a standard

- **No** test framework — do not add Vitest or Jest without a project-roadmap entry.
- **No** state library (Redux, Zustand, Jotai) — the existing `AppContext` is enough.
- **No** CSS-in-JS.
- **No** Storybook.
- **No** environment variable file (`.env`) in v1 — the only "secret" is `rapidApiKey` in `localStorage`.

## 14. See also

- `system-architecture.md` — how the modules talk
- `design-guidelines.md` — visual rules
- `project-overview-pdr.md` — the product context these standards serve
