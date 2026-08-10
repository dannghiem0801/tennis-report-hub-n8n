# Deployment Guide — Tennis Report Hub

> How to ship the SPA. v1 has no server-side concerns; the entire app is a static bundle.

## 1. Build outputs

`npm run build` runs `tsc -b && vite build` and produces:

```
dist/
├── index.html                 # entry; references hashed JS + CSS
├── assets/
│   ├── index-<hash>.js
│   ├── index-<hash>.css
│   └── ...                    # any additional chunks Vite emits
├── favicon.svg
└── icons.svg
```

The `dist/` directory is the deployable artifact. There is no `server.js`, no `functions/`, no `api/`. Anything that can serve static files can host this app.

## 2. Local production preview

```bash
npm install
npm run build
npm run preview          # serves dist/ on http://localhost:4173
```

`npm run preview` runs Vite's static server. Use it to verify the built bundle before deploying.

## 3. Required runtime

- **Node**: any LTS ≥ 20 is fine for `npm install` / `npm run build`. (Not needed at runtime.)
- **Browser**: current-2 evergreen (Chromium, Firefox, Safari). The app uses ES2023 + native CSS variables.
- **JavaScript must be enabled**. The app does not render without it.

## 4. Environment variables

For a production LLM, store `LLM_API_KEY` as a Vercel Environment Variable. It is read only by the `/api/llm/v1/messages` serverless function, which forwards Anthropic-compatible requests for the browser. Do not set `VITE_LLM_API_KEY` in production: every `VITE_*` variable can be embedded in the client bundle.

`VITE_LLM_ENABLED`, `VITE_LLM_PROVIDER`, `VITE_LLM_BASE_URL`, and `VITE_LLM_MODEL` are non-secret build-time configuration. The browser needs them to select the provider and model; it does not need the API key.

## 5. Hosting

Any of the following works. Pick by team preference and CDN needs.

### 5.1 Netlify

1. Connect the repo.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Node version: 20 (set in `netlify.toml` or the UI)

`netlify.toml` (drop in repo root):

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"
```

SPA fallback (so client-side routes work after a hard refresh):

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### 5.2 Vercel

1. Import the repo.
2. Framework preset: **Vite**.
3. Build command: `npm run build` (Vercel detects this).
4. Output directory: `dist`.
5. Set `LLM_API_KEY` for Production (and Preview if previews should generate reports). Keep it server-side, without a `VITE_` prefix.

Keep the tracked `vercel.json`: it sends client-side routes to `index.html`, preserves `/api/*` and static assets, and rewrites `/api/flashscore/*` to the Flashscore function.

#### Verified project topology (2026-08-10)

The canonical deployment is the Git-linked Vercel project. At verification time, local `main` and the deployed commit were both `eff256e`.

| Setting | Canonical value |
| --- | --- |
| Local link | `.vercel/repo.json` |
| Project | `tennis-report-hub` (`prj_zyhD0KGF5xH7A9YJxvS05RQyVdjL`) |
| Owner | `dannghiem0801s-projects` |
| Git repository | `dannghiem0801/tennis-report-hub` |
| Production branch / URL | `main` / `https://tennis-report-hub.vercel.app` |
| Build settings | Root `.`, Vite, `npm run build`, output `dist`, Node 24.x |

Several worktrees have explicit, independent Vercel links:

| Worktree | Project | Git/deployment state at verification |
| --- | --- | --- |
| `.worktrees/feat-apnews-20260808` | `tennis-report-hub-apnews` (`prj_rVeGWvQyNdcfeGgsIKVX2rRfW61s`) | Manual, no Git link; production `ERROR`, preview `READY` at `b4da0cd` |
| `.worktrees/feat-apnews-20260808-v2` | `tennis-report-hub-apnews-v2` (`prj_6pXjSoL2e6NDI25LJ1b6R2kpLzwd`) | Manual, no Git link; production `READY` at `e327752` |
| `.worktrees/feat-multi-sport-20260807` | `feat-multi-sport-20260807` (`prj_DTvfYjxnvd3bGTKb0Bwew0PtL57q`) | Manual, no Git link; production `READY` at `98faa9d` |
| `.worktrees/feat-auto-20260808-1e804fa2` | Canonical `tennis-report-hub` | Links back to the canonical project |

The related project `feat-auto-20260808-unified-watchlist-v2` (`prj_5XffvfEJMrVHHas22qOF5XYHD5WC`) is currently orphaned: it has no local `.vercel` link, Git link, or deployments.

Prefer the canonical project's Git integration for feature work; it already creates branch previews (latest observed: `feat/apnews-20260808-v2`). Before deploying, inspect the root `.vercel/repo.json` or the worktree's `.vercel/project.json`. Do not casually relink the repository root, because that changes the deployment target for root-level Vercel commands.

Refresh this inventory with read-only commands:

```bash
vercel whoami
vercel project ls
vercel project inspect tennis-report-hub
```

### 5.3 Cloudflare Pages

1. Connect the repo.
2. Build command: `npm run build`
3. Build output: `dist`
4. Compatibility flags: none required.

For SPA fallback, add a `_redirects` file in `public/`:

```
/*    /index.html   200
```

### 5.4 GitHub Pages

1. In repo settings → Pages, set source to "GitHub Actions".
2. Use the standard Vite Pages workflow (`.github/workflows/deploy.yml`):

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    permissions: { pages: write, id-token: write }
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Note: GitHub Pages serves from a subpath on user/org sites. If the site is `https://USER.github.io/tennis-report-hub/`, set `base` in `vite.config.ts`:

```ts
export default defineConfig({
  base: "/tennis-report-hub/",
  // ...
});
```

## 6. CI

The repo has no CI today. Recommended first CI job (when added): **typecheck + build** on every PR.

`.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run build
```

`npm run build` already runs `tsc -b` (the Vite build script is `tsc -b && vite build`). A type failure fails the build, which is the right behavior for a small app without a separate `typecheck` script. Run `npm run test:llm-proxy` to verify that a production browser can use the server-side LLM proxy without holding an API key.

## 7. Cache strategy

The bundled assets in `dist/assets/` have content-hashed filenames (`index-abc123def.js`). Set a long max-age for them and treat `index.html` as no-cache:

| Path                  | `Cache-Control`              |
| --------------------- | ---------------------------- |
| `/index.html`         | `no-cache`                   |
| `/assets/*`           | `public, max-age=31536000, immutable` |
| `/favicon.svg`, `/icons.svg` | `public, max-age=86400` |

All three major hosts (Netlify, Vercel, Cloudflare Pages) set sensible defaults; override only if a CDN-level config demands it.

## 8. Verifying a deploy

A short smoke test, in order:

1. Open `/`. The dashboard renders with 3 tournaments.
2. Open DevTools → Application → Local Storage. Confirm the `trh:*` keys appear after you click a star.
3. Star a `scheduled` match, then star a `completed` match (the sample data has both). The `completed` match should produce a report within ~600ms (the simulated latency).
4. Open `/reports`. The new report card is there.
5. Open `/templates`. Edit the Mặc định template, save. Refresh. The edit persists.
6. Open `/settings`. Change polling to 1 minute, save. Wait, watch the "Cập nhật lần cuối" timestamp.
7. Hard-refresh the page on each route (`/`, `/reports`, `/templates`, `/settings`). Each should render (this is the SPA-fallback test).

## 9. Rollback

Static hosting makes rollback trivial: redeploy the previous build. Tag each release:

```bash
git tag v1.0.0
git push --tags
```

Keep a record of the deployable commit SHA alongside each release tag.

## 10. What this guide will look like in v2

- Add a **Supabase** section: project URL, anon key (env var), service-role key (server-side only, never shipped to the client).
- Add an **Edge Functions** section for the polling cron and the email digest.
- Add a **CORS** note for the real RapidAPI proxy.
- Add **observability**: Sentry / Logflare / Supabase logs for the auto-gen failures.

## 11. See also

- `system-architecture.md` — the runtime the deploy is shipping
- `project-roadmap.md` — the v2 deploy story
- `codebase-summary.md` — what's actually inside `dist/`
