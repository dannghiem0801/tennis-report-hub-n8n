# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React 19 + TypeScript application. Organize UI by domain under `src/components/`, route-level screens under `src/pages/`, shared state and localStorage persistence under `src/store/`, API clients and response mapping under `src/api/`, and report generation under `src/reports/`. Shared types and utilities live in `src/types/` and `src/lib/`. Vercel serverless handlers are in `api/`; development-only Vite extensions are in `vite-plugins/`. Place static assets in `public/`, operational scripts in `scripts/`, and architecture, standards, ADRs, and release notes in `docs/`.

## Build, Test, and Development Commands

- `npm install` installs the locked dependency set from `package-lock.json`.
- `npm run dev` starts Vite at `http://localhost:5173` with development proxies.
- `npm run lint` runs Oxlint, including React hooks checks.
- `npm run build` runs TypeScript project checks, then creates the production bundle in `dist/`.
- `npm run preview` serves the built bundle locally.
- `npx tsx scripts/test-pipeline.ts` exercises point-by-point mapping, match details, and pipeline state transitions.

Some scripts call live services. For example, `FIRECRAWL_API_KEY=... node scripts/test-firecrawl.mjs` requires a valid key and network access.

## Coding Style & Naming Conventions

Use two-space indentation and follow the formatting of the surrounding file; no formatter is configured. Keep TypeScript strict: avoid `any`, use `import type` for type-only imports, and remove unused symbols. Name source files in kebab-case (`match-row.tsx`), export components as PascalCase functions, and use camelCase for variables and functions. Prefer `@/` imports across modules and relative imports only within a folder. Build UI with Tailwind utilities and `cn()` for conditional classes. Keep user-facing copy in Vietnamese.

## Testing Guidelines

The repository has no formal unit-test framework or coverage threshold. Treat `npm run lint` and `npm run build` as the minimum pre-PR checks. Run the relevant script in `scripts/` when changing API mapping, search, report prompts, or point-by-point behavior. Name new automated tests `*.test.ts` or `*.test.tsx` and document any introduced runner in `package.json` and `docs/`.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects such as `feat(watchlist): ...`, `fix(mapper): ...`, and `build: ...`. Use an imperative, focused subject and include a scope when useful. Pull requests should explain the user-visible change, note configuration or schema impacts, link the issue or ADR, and list verification performed. Include screenshots for UI changes and never commit `.env.local`, API keys, generated `dist/`, or local `.vercel/` data.
