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

**None in v1.** The only "secret" is `rapidApiKey` and it is stored client-side in `localStorage`. When the real API integration lands (v2), secrets will be proxied through a Supabase Edge Function rather than the browser.

If a future environment file is added, follow the Vite convention (`VITE_*` prefix, accessed via `import.meta.env.VITE_*`). Do not introduce non-Vite env vars.

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

Vercel handles SPA fallback by default. No config file needed.

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

`npm run build` already runs `tsc -b` (the Vite build script is `tsc -b && vite build`). A type failure fails the build, which is the right behavior for a small app without a separate `typecheck` script.

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
