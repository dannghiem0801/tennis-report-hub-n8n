# Integrating the n8n Pipeline as Backend for Tennis Report Hub

**Date:** 2026-08-17
**Repo:** `tennis-report-hub` (Vite + React 19 + TS, deployed on Vercel as static SPA)
**Backend to integrate:** The n8n → Hermes agent pipeline described in `/home/duc_homelab/pipeline-scope.md`

---

## 1. Current State of the Repo (what we analysed)

### 1.1 Architecture — 100% client-side SPA

```
Browser (React SPA, Vercel)
  ├── src/api/flashscore.ts     → RapidAPI flashscore4 (fixtures, match details, PBP)
  ├── src/api/llm.ts            → LLM direct from browser (Anthropic/OpenAI-compatible)
  ├── src/store/app-store.tsx   → state + polling + auto-on-completion → generateReport()
  ├── src/reports/generate.ts   → literal fill-in template OR LLM prompt
  └── src/store/persistence.ts  → localStorage (Supabase-shaped abstraction)
```

**Key facts:**
- **No backend.** All state in `localStorage` (`trh:watchlist`, `trh:reports`, `trh:templates`, `trh:settings`, `trh:seenReports`, `trh:scheduledBatches`).
- **Report generation today:** two paths in `src/reports/generate.ts` → `applyTemplate()`:
  - `literal` templates: deterministic placeholder fill-in (no LLM).
  - `prompt` templates: builds a prompt, calls the LLM **directly from the browser** via `src/api/llm.ts` (default provider Anthropic-compatible MiniMax proxy). On failure → falls back to saving the prompt text.
- **Auto-on-completion:** in `app-store.tsx`, an effect watches the watchlist; when a match transitions to `completed`, it fetches PBP + stats, builds context, and calls `generateReport()`.
- **WatchlistEntry lifecycle:** `pending → fetching-pbp → building-context → web-searching → consolidating → completed | failed` (see `src/types/index.ts`).
- **Persistence layer is designed to be swapped:** `src/store/persistence.ts` comment says "In production this would call Supabase client" — only this file (plus the store's direct calls) needs to change to move data to a backend.

### 1.2 What the app does NOT have (gap vs the n8n pipeline)

| Capability | App today | n8n pipeline |
|---|---|---|
| Vietnamese recap research (≥2 sources, editorial template) | LLM prompt with app-provided PBP/stats; **no web search by default** (stub) | Hermes agent: web_search + web_extract, cross-check, editorial template |
| YouTube highlights → Drive (H.264, public share) | ❌ not present | ✅ full pipeline |
| Persistent report store | localStorage per browser | Google Sheets (tab Tennis) + Drive |
| Multi-user / shared state | ❌ (local only) | ✅ sheet is shared |
| Scheduled batch safety-net | client-side `ScheduledBatch` | ✅ n8n poll (every 10 min) acts as the trigger |

---

## 2. Integration Options

### Option A — Sheets as the bridge (minimal change, recommended first step)

The app **writes rows to the existing Google Sheet** (tab `Tennis`) exactly as you do manually today. n8n polls → Hermes agent does research + recap + YouTube→Drive → updates the same row (Status, Report, Drive link). The app **reads rows back** through the proxy to display results.

```
React SPA ──POST /api/matches──▶ FastAPI wrapper (:8800) ──append row──▶ Google Sheet (Tennis)
                                                                              │ n8n poll 10'
                                                                              ▼
React SPA ◀──GET /api/matches── FastAPI wrapper ◀──proxy :8787── Google Sheet (updated: Done + Report + Drive)
```

**Changes in the repo:**
1. New `src/api/backend.ts` — thin client with `submitMatch()`, `getMatches()`, `getMatch(id)`.
2. In `app-store.tsx`, replace the `generateReport()` call inside auto-on-completion with `backend.submitMatch({...})`; map the returned status back onto the `WatchlistEntry` lifecycle.
3. `src/store/persistence.ts`: keep localStorage for settings/templates (user prefs), but **read reports from the backend** instead of `trh:reports` (or mirror both).
4. Add a "YouTube link" input on the watchlist (optional — pipeline works without video, but video is a bonus; link enables the Drive part).

### Option B — Direct webhook POST (near-real-time, no sheet round-trip)

Skip the sheet for submission: the FastAPI wrapper (or the app's own tiny serverless function) POSTs directly to `:8644/webhooks/sheets-recap` with HMAC. The agent writes results back to the sheet anyway (needed as the report store), so reads still go through the proxy.

- Latency drops from ≤10 min to seconds (no poll wait).
- Requires HMAC signing server-side (never ship the secret to the browser).

### Option C — Full REST API (recommended for a product)

Build a small FastAPI service on the homelab (port 8800) exposing:

```
POST /api/matches              {sport, match_label, youtube_link?, extra:{...}} → 202 {row_index}
GET  /api/matches              → [{row_index, match, status, report, drive_url, updated_at}]
GET  /api/matches/{row_index}  → single match detail
GET  /api/status               → pipeline health (proxy, gateway, n8n last execution)
```

Internally: `submitMatch` appends a row to the sheet (or POSTs webhook in Option B); `getMatches` reads via the proxy. This wrapper is the single backend contract — the React app never touches Google APIs or HMAC secrets.

---

## 3. Recommended Architecture (Option A + C combined)

```
┌─────────────────────────────┐
│ React SPA (Vercel, static)  │
│  src/api/backend.ts         │
└──────────┬──────────────────┘
           │ fetch (CORS-enabled, no secrets)
           ▼
┌─────────────────────────────┐   systemd service (fastapi-backend.service)
│ FastAPI wrapper :8800       │   /home/duc_homelab/docker/n8n/backend_api.py
│  POST /api/matches          │── append row → Google Sheets (Tennis tab)
│  GET  /api/matches          │── read via proxy GET :8787/sheets?tab=Tennis
│  GET  /api/matches/{id}     │
│  GET  /api/status           │
└──────────┬──────────────────┘
           │ (no changes needed)
           ▼
   n8n (:5678, existing) → proxy (:8787) → webhook (:8644) → Hermes agent
```

### Files to add/change in the repo

| File | Change |
|---|---|
| `src/api/backend.ts` | **NEW** — typed client: `submitMatch`, `getMatches`, `getMatch`, `getStatus`; `VITE_BACKEND_URL` env |
| `src/lib/env.ts` | add `backendUrl()` reading `VITE_BACKEND_URL` (default `http://192.168.1.169:8800`) |
| `src/store/app-store.tsx` | auto-on-completion effect: call `backend.submitMatch()` instead of `generateReport()`; add `backendStatus` to `WatchlistEntry` (queued/processing/done/failed) |
| `src/store/persistence.ts` | reports: read from backend (fallback to localStorage if backend unreachable) |
| `src/types/index.ts` | add `BackendMatchStatus` union; extend `WatchlistEntry` with `backendRowIndex?`, `driveUrl?`, `backendError?` |
| `src/components/watchlist/*` | show pipeline status + "Xem trên Drive" link |
| `.env.example` | document `VITE_BACKEND_URL` |

### FastAPI wrapper sketch

```python
# backend_api.py (runs on homelab :8800, systemd)
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx, os

SPREADSHEET_ID = "1Q1LWnF3DhE9xHovdgqWG09ir4fc8gNJ6lht-aj3KPm4"
PROXY = "http://localhost:8787/sheets"
GAPI = "python /home/duc_homelab/.hermes/profiles/htv/skills/productivity/google-workspace/scripts/google_api.py"

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/api/matches")
async def submit_match(body: dict):
    # body: {sport: "tennis", match: "...", youtube_link: "..."}
    # 1) append row to tab (Tennis/Soccer) via google_api.py sheets append
    # 2) return {row_index, status: "queued"}
    ...

@app.get("/api/matches")
async def list_matches():
    # read proxy ?tab=Tennis, filter out header, return rows
    ...

@app.get("/api/matches/{row_index}")
async def get_match(row_index: int):
    ...
```

---

## 4. Detailed Integration Steps

### Phase 1 — Backend wrapper (homelab)
1. Create `backend_api.py` (FastAPI) with the 4 endpoints above; run as systemd service on :8800.
2. CORS `allow_origins=["*"]` for dev; lock down for prod (Vercel domain).
3. Verify with `curl`:
   ```bash
   curl -X POST localhost:8800/api/matches -H 'Content-Type: application/json' \
     -d '{"sport":"tennis","match":"TEST BACKEND | A v B 17/08/2026","youtube_link":""}'
   curl localhost:8800/api/matches
   ```

### Phase 2 — React client
1. Add `src/api/backend.ts` with typed functions + `VITE_BACKEND_URL`.
2. Add `backendUrl()` to `src/lib/env.ts`.
3. Replace the `generateReport()` call site in `app-store.tsx` with `backend.submitMatch(...)`.
4. Map `BackendMatchStatus` (queued/processing/done/failed) onto the watchlist UI.
5. On reports page, load from backend (fallback localStorage).

### Phase 3 — Mapping match label (important)
The sheet expects the `Match` cell format:
```
"SHE 0-2 FAR | Ben Shelton v Jaime Faria 16/08/2026 | Tennis - Flashscore | Match"
```
The app has structured `Match` objects (player1/player2, score, tournament). Build the label server-side:
```python
label = f"{p1_code} {p1_wins}-{p2_wins} {p2_code} | {p1_name} v {p2_name} {date} | Tennis - Flashscore | Match"
```
The Hermes agent then re-researches the match from this label (it does its own web_search + Flashscore extraction), so the app's PBP data is a **bonus**, not a dependency.

### Phase 4 — Drive video
- The pipeline already handles YouTube→Drive when `youtube_link` is present. Add an optional YouTube URL field to the watchlist / submit form; blank = recap only.

---

## 5. What Stays vs What Changes

**Stays (no change):**
- n8n workflows (both), proxy, webhook subscriptions, Hermes agent, skills.
- Google Sheets schema — the app writes the same rows you add manually.
- The editorial quality bar (Hermes cross-checks ≥2 sources, Vietnamese prose template).

**Changes:**
- `app-store.tsx`: auto-on-completion now enqueues to backend instead of generating in-browser.
- `persistence.ts`: reports read from backend (localStorage kept for settings/templates).
- New `src/api/backend.ts` + FastAPI wrapper.

---

## 6. Acceptance Criteria

1. User adds a match to watchlist → match completes → within ≤10 min the app shows Status=Done with the Vietnamese recap text and Drive link (if YouTube link given).
2. No browser-side secrets (RapidAPI key stays for fixtures; LLM key no longer needed — the pipeline owns generation).
3. Existing literal-template reports keep working offline (localStorage fallback).
4. `GET /api/status` returns healthy when proxy + gateway + last n8n execution are OK.
