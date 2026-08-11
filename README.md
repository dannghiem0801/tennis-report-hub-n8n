# 🎾 Tennis Report Hub

Dashboard lịch thi đấu tennis theo ngày cho phóng viên thể thao Việt Nam, tích hợp tự động viết báo cáo trận đấu tiếng Việt sau khi trận kết thúc.

## ✨ Tính năng

- **Live tennis data**: Kết nối trực tiếp với FlashScore API trên RapidAPI (`flashscore4.p.rapidapi.com`) — ATP + WTA + Challenger + ITF fixtures theo ngày, kèm tournament tier (Grand Slam → ITF). 100% dữ liệu thật, không có fallback mẫu.
- **Dashboard trực quan**: Gom trận theo giải, sắp xếp live → scheduled → completed, có banner trạng thái Live API.
- **Smart date fallback**: khi ngày đang chọn rỗng (off-day, chưa publish lịch), tự động tìm ngày gần nhất có trận trong 7 ngày gần nhất, kèm banner giải thích.
- **Watchlist**: Theo dõi trận, tự động nhận báo cáo khi trận kết thúc.
- **Auto report generation**: Tự động sinh báo cáo tiếng Việt 200-400 từ theo template.
- **Report history**: Lưu trữ, tìm kiếm, lọc, sắp xếp tất cả báo cáo đã viết.
- **Template management**: 3 template có sẵn (Mặc định / Ngắn gọn / Kịch tính) + tạo mới.
- **Settings**: kiểm tra kết nối Tennis API phía máy chủ, polling interval, timezone, notifications.
- **Dark mode**: Theme tối tối ưu cho mắt làm việc khuya, font Inter hỗ trợ đầy đủ tiếng Việt.

## 🚀 Cài đặt

```bash
npm install
cp .env.example .env.local   # thêm RAPID_API_KEY để chạy dữ liệu live ở local
npm run dev                  # http://localhost:5173
npm run build                # production build
```

## 🔐 Biến môi trường (`.env.local`)

Đặt `RAPID_API_KEY` trong `.env.local` khi chạy local hoặc trong Vercel Environment Variables khi deploy. Key này chỉ được đọc ở máy chủ/proxy, không được đưa vào bundle hay localStorage. Nếu đã đặt `RAPID_MCP_API_KEY` cho cùng RapidAPI Application, REST proxy có thể dùng nó làm fallback.

```bash
cp .env.example .env.local
# sửa .env.local, điền key vào
```

**Quy ước đặt tên:** biến nào muốn browser đọc được phải có prefix `VITE_` (Vite chỉ expose các biến này). Không dùng prefix `VITE_` cho key LLM của production; Vercel proxy phải đọc `LLM_API_KEY` ở server.

**Các biến hỗ trợ:**

| Biến | Mục đích | Mặc định |
| --- | --- | --- |
| `RAPID_API_KEY` | Tennis data (RapidAPI flashscore4), server-side only | `""` |
| `RAPID_API_HOST` | RapidAPI host, server-side only | `flashscore4.p.rapidapi.com` |
| `VITE_LLM_ENABLED` | Bật/tắt auto report generation | `false` local; `true` by default on a deployed Vercel site using `LLM_API_KEY` |
| `VITE_LLM_PROVIDER` | `anthropic` hoặc `openai-compatible` | `anthropic` |
| `VITE_LLM_BASE_URL` | Base URL của LLM proxy / API | `https://api.minimax.io/anthropic` |
| `VITE_LLM_API_KEY` | Key cho gọi LLM trực tiếp ở local/dev; không dùng trên Vercel production | `""` |
| `VITE_LLM_MODEL` | Model identifier | `MiniMax-M3` |
| `VITE_LLM_TEMPERATURE` | Sampling temperature `[0, 2]` | `0.7` |
| `VITE_LLM_MAX_TOKENS` | Max output tokens | `200000` |
| `VITE_LLM_ENABLE_THINKING` | Anthropic only — bật thinking blocks | `true` |
| `VITE_LLM_ENABLE_WEB_SEARCH` | Anthropic only — khai báo `web_search` tool | `true` |
| `VITE_LLM_SEARCH_PROVIDER` | `firecrawl` / `duckduckgo` / `serpapi` / `brave` | `firecrawl` |
| `VITE_LLM_SEARCH_API_KEY` | API key cho search backend | `""` |
| `LLM_PROXY_URL` | Dev proxy target (server-side only, không prefix) | `https://api.minimax.io/anthropic` |
| `LLM_API_KEY` | Key Anthropic-compatible chỉ cho Vercel function `/api/llm/v1/messages` | `""` |

Biến `RAPID_API_KEY` không có tiền tố `VITE_` và không thể được thay đổi từ Settings UI. Các cấu hình LLM phía client vẫn có thứ tự ưu tiên sau:

1. **`.env.local`** (canonical — đặt một lần, dùng mọi browser)
2. **localStorage** (Settings UI — override runtime)
3. **Hardcoded defaults** trong code

Khi reload, env luôn thắng. Nếu muốn thay đổi từ Settings UI bền vững, hãy xoá dòng tương ứng trong `.env.local`. Khi một biến env đang set, Settings UI sẽ hiện badge **"Từ .env"** cạnh input để bạn biết giá trị nào đang được load từ env.

### Cách A — sửa `.env.local` bằng tay

Mở file, điền key, lưu lại. Vite tự detect thay đổi và reload browser.

```bash
$EDITOR .env.local
# Vite reload ~1s sau khi save
```

### Cách B — sửa trên UI, bấm "Lưu vào .env.local"

Trong Settings, điền / chỉnh các key, bấm nút **💾 Lưu vào .env.local** ở góc phải tiêu đề. Nút này POST lên dev middleware (`POST /__save-env`) để ghi ngược vào file `.env.local` thật. Vite cũng sẽ tự reload sau khi ghi.

**Middleware bảo mật:**
- Chỉ chạy ở dev mode (`apply: "serve"`), production build không có.
  - Chỉ chấp nhận key match `^VITE_[A-Z0-9_]+$` hoặc `LLM_PROXY_URL`. Mọi key khác trả về 400.
- File path cố định ở `.env.local` ở project root, không chấp nhận path traversal.
- Value có whitespace / quote / ký tự đặc biệt sẽ tự wrap trong double quotes theo dotenv spec.

**Endpoint reference** (nếu bạn muốn gọi từ terminal / script):

```bash
curl -X POST http://localhost:5173/__save-env \
  -H "Content-Type: application/json" \
  -d '{"VITE_LLM_API_KEY":"sk-ant-..."}'
# {"ok":true,"wrote":["VITE_LLM_API_KEY"]}
```

> ⚠️ **Bảo mật:** Tất cả biến `VITE_*` đều được Vite inline vào bundle client. Mọi người dùng trang có thể xem được key. Chấp nhận được cho dùng cá nhân / demo. Với LLM production, chỉ đặt `LLM_API_KEY` trong Vercel Environment Variables; browser gọi server proxy và không nhận key.

## 🔌 Tennis API (RapidAPI — flashscore4)

1. Đăng ký gói tại [flashscore4 trên RapidAPI](https://rapidapi.com/search/flashscore4%20tennis) (host: `flashscore4.p.rapidapi.com`).
2. Đặt `RAPID_API_KEY` trong Vercel Environment Variables cho Production/Preview (và `.env.local` cho local development).
3. Deploy lại, rồi bấm **Test connection** tại `/settings` để xác nhận proxy phía máy chủ. Dashboard tự gọi API qua proxy; người dùng không cần nhập key.

**API workflow** (single call trả về toàn bộ trận trong ngày):

```
Browser → GET /api/flashscore/v2/matches/list-by-date?sport_id=2&date=YYYY-MM-DD&timezone=Asia%2FBangkok
Server proxy → flashscore4.p.rapidapi.com (thêm X-Rapidapi-Key từ RAPID_API_KEY)
```

**sport_id mapping** (từ endpoint `/get-sports`):
- `1` = Football
- `2` = Tennis ← app mặc định
- `3` = Basketball
- (xem `/get-sports` cho đầy đủ danh sách)

**Response shape:** Hiện tại TBD — mapper xử lý defensive nhiều pattern phổ biến (flat array, `{ matches }`, `{ data }`, `{ stages/events }`). Sau khi chạy test call thật, paste JSON response vào `src/api/flashscore-mapper.ts` để tighten field paths.

**Timestamp:** IANA timezone name trong query param (`Asia/Ho_Chi_Minh` cho VN). Response time format tùy API (ISO 8601 hoặc epoch) — mapper tự detect.

**Status mapping:** Mapper chấp nhận cả number (`1`/`2`+ = scheduled/live) và string (`"FT"`/`"NS"`/`"S1"`-`"S5"`/...).

**Match details (per-match, for completed matches):**

```
GET /api/flashscore/v2/matches/details?match_id=<id>
```

Trả về set-by-set scores (e.g. `6-4, 3-6, 6-3`) + stats (aces, double faults, first serve %, break points, etc.) mà list-by-date không expose. Dùng để enrich report khi trận đã completed. Cached 24h (kết quả immutable sau khi trận kết thúc).

**Không được expose bởi API này ở endpoint list-by-date** (theo contract hiện tại): country, court, surface, ranking, seed, set scores chi tiết. Mapper dùng placeholder:
- `country` → `""`, flag → `🏳️`
- `round` → `"—"`
- `court` → `undefined`
- `surface` → `"hard"` (default)
- Set scores/stats → dùng endpoint `/matches/details` (xem trên) — fallback scrape từ web (xem templates.ts)

**Rate limit & cache:**
- List-by-date: cache 30 phút. Mỗi lần bấm Refresh trong cùng cache window = 0 request.
- Polling: **mặc định "No Poll" (= 0)** — app không tự fetch, chỉ gọi khi user bấm Refresh. Tối ưu cho quota 1,000 requests/ngày (hard limit) của RapidAPI (flashscore4). Có thể bật lại 1/5/10/15/30 phút nếu cần theo dõi real-time — với 1,000/ngày thì 5 phút poll (~288 calls/ngày) vẫn dư dả.
- Worst case: 1 call/refresh. "No Poll" + manual 3-4 buổi/tuần × 2h × 5 refresh = ~40 calls/tuần ≈ **160 calls/tháng** (dư ~340 cho edge cases).

> ✅ **Bảo mật:** RapidAPI key chỉ tồn tại trong môi trường máy chủ. Browser gọi endpoint cùng origin và không gửi header RapidAPI.

### RapidAPI MCP enrichment (experimental)

The app includes a server-only MCP bridge at `POST /api/mcp/enrich`. It is disabled by default and is intentionally limited to the read-only tool names listed in `RAPID_MCP_ALLOWED_TOOLS`. A request may contain at most `RAPID_MCP_MAX_CALLS` calls (default: 2); every returned item has a stable `mcp-*` evidence ID and timestamp. After the server variables are configured, `GET /api/mcp/tools` shows the available tool names so the allowlist can be selected without guessing.

For every completed prompt-based report, the app fetches MCP evidence before it asks the LLM to write: **tennis** uses `Get_Match_Stats` + `Get_Match_Point_by_Point`; **football** requires `Get_Match_Details` + `Get_Match_Summary`, then requests optional `Get_Match_Commentary`. Set `RAPID_MCP_MAX_CALLS=3` and allow the football tool names shown by `GET /api/mcp/tools`. Commentary is skipped safely when the subscribed catalog does not expose it; the required sources remain protected by the normal soft fallback if MCP itself is unavailable.

To enable it, open the Flashscore4 Playground in RapidAPI, select the subscribed Application, click **MCP**, then copy the exact URL and host-routing values into Vercel server environment variables. For the supplied Flashscore config, set `RAPID_MCP_REQUEST_HEADERS={"x-api-host":"flashscore4.p.rapidapi.com"}`; the server sends `RAPID_MCP_API_KEY` as `x-api-key`. Do not expose the generated configuration or key in `VITE_*` variables or the Settings UI. Run `npm run test:rapid-mcp` to verify the offline client contract before deployment; an authenticated live smoke test is only possible after the Playground configuration is installed.

## 🏗️ Tech stack

- **React 19** + **TypeScript** + **Vite 8**
- **Tailwind CSS v4** (với CSS variables cho theming)
- **shadcn/ui** (custom build trên Radix UI primitives)
- **React Router v7** (4 trang: /, /reports, /templates, /settings)
- **Lucide React** (icons)
- **Sonner** (toasts)
- **localStorage** (v1 — sẽ chuyển sang Supabase ở v2)

## 📁 Cấu trúc

```
src/
├── api/                  # Tennis API client (tennis.ts), country flags, response mappers
├── components/
│   ├── ui/              # shadcn-style primitives
│   ├── layout/          # TopBar
│   ├── dashboard/       # TournamentBrowser, TournamentCard, MatchRow
│   ├── watchlist/       # WatchlistSidebar
│   └── reports/         # ReportViewer
├── pages/                # 4 trang chính
├── store/                # App state + persistence layer
├── reports/              # Report generation engine + templates
├── data/                 # (deprecated) — sample data removed; 100% live API now
├── types/                # TypeScript types
└── lib/                  # Utilities
```

## 🎯 Tính năng v1 (đã build)

- [x] Sports selector với badge "Coming Soon" cho môn khác
- [x] Tournament browser với expand/collapse + match rows
- [x] Live data từ RapidAPI flashscore4 (single call: `/api/flashscore/v2/matches/list-by-date`)
- [x] Smart date fallback: tự tìm ngày gần nhất có trận khi ngày đang chọn rỗng (off-day, chưa publish lịch)
- [x] Banner trạng thái (Live API) + banner lỗi chi tiết
- [x] Settings: nút "Test connection" với thông báo lỗi theo mã (401/403/429/CORS)
- [x] Watchlist sidebar với 2 tabs (Đang chờ / Đã viết)
- [x] Auto report generation khi match completed
- [x] Report viewer modal với edit + copy
- [x] Report history page với search/filter/sort
- [x] Template management (CRUD + set default)
- [x] Settings (API key, polling, timezone)
- [x] Polling mặc định No Poll (= 0), có thể bật 1/5/10/15/30 phút nếu cần
- [x] Responsive mobile cơ bản
- [x] Vietnamese UI 100%

## 🔮 Tính năng v2 (defer)

- Auth & user management
- Multi-sport (Bóng đá, Bóng rổ)
- Export Google Docs
- Email báo cáo tự động
- Supabase backend (thay localStorage)
- Server proxy cho RapidAPI key (giữ key bí mật)
- Extend API integration (live scores, completed matches, point-by-point)
- Background polling qua Edge Function
- H2H comparison + rankings

## 🛠️ Customization

Thêm/sửa template: Vào `/templates` → "Tạo mẫu mới" hoặc edit template có sẵn.

Đổi API host/endpoint: Edit `src/api/flashscore.ts` (hằng `API_HOST` + hàm `fsFetch`).

Cấu hình polling: Vào `/settings` → "Khoảng thời gian (phút)".

Đổi API host/endpoint: Edit `src/api/flashscore.ts` (hằng `API_HOST` + hàm `fsFetch`).
