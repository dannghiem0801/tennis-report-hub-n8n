# 🎾 Tennis Report Hub

Dashboard lịch thi đấu tennis theo ngày cho phóng viên thể thao Việt Nam, tích hợp tự động viết báo cáo trận đấu tiếng Việt sau khi trận kết thúc.

## ✨ Tính năng

- **Live tennis data**: Kết nối trực tiếp với livescore6 API trên RapidAPI — ATP + WTA + Challenger fixtures theo ngày, kèm tournament tier (Grand Slam → ITF). 100% dữ liệu thật, không có fallback mẫu.
- **Dashboard trực quan**: Gom trận theo giải, sắp xếp live → scheduled → completed, có banner trạng thái Live API.
- **Smart date fallback**: khi ngày đang chọn rỗng (off-day, chưa publish lịch), tự động tìm ngày gần nhất có trận trong 7 ngày gần nhất, kèm banner giải thích.
- **Watchlist**: Theo dõi trận, tự động nhận báo cáo khi trận kết thúc.
- **Auto report generation**: Tự động sinh báo cáo tiếng Việt 200-400 từ theo template.
- **Report history**: Lưu trữ, tìm kiếm, lọc, sắp xếp tất cả báo cáo đã viết.
- **Template management**: 3 template có sẵn (Mặc định / Ngắn gọn / Kịch tính) + tạo mới.
- **Settings**: RapidAPI key (với nút Test connection), polling interval, timezone, notifications.
- **Dark mode**: Theme tối tối ưu cho mắt làm việc khuya, font Inter hỗ trợ đầy đủ tiếng Việt.

## 🚀 Cài đặt

```bash
npm install
cp .env.example .env.local   # tuỳ chọn — chỉ cần khi muốn set key qua .env
npm run dev                  # http://localhost:5173
npm run build                # production build
```

## 🔐 Biến môi trường (`.env.local`)

Mọi API key có thể đặt trong `.env.local` để app tự load lúc khởi động — không cần paste vào Settings UI. Copy từ template:

```bash
cp .env.example .env.local
# sửa .env.local, điền key vào
```

**Quy ước đặt tên:** biến nào muốn browser đọc được phải có prefix `VITE_` (Vite chỉ expose các biến này). Biến không có prefix (như `LLM_PROXY_URL`) chỉ dùng cho dev proxy, không bao giờ ship ra client.

**Các biến hỗ trợ:**

| Biến | Mục đích | Mặc định |
| --- | --- | --- |
| `VITE_RAPID_API_KEY` | Tennis data (RapidAPI livescore6) | `""` |
| `VITE_LLM_ENABLED` | Bật/tắt auto report generation | `false` |
| `VITE_LLM_PROVIDER` | `anthropic` hoặc `openai-compatible` | `anthropic` |
| `VITE_LLM_BASE_URL` | Base URL của LLM proxy / API | `https://api.minimax.io/anthropic` |
| `VITE_LLM_API_KEY` | Bearer / x-api-key cho LLM | `""` |
| `VITE_LLM_MODEL` | Model identifier | `MiniMax-M3` |
| `VITE_LLM_TEMPERATURE` | Sampling temperature `[0, 2]` | `0.7` |
| `VITE_LLM_MAX_TOKENS` | Max output tokens | `200000` |
| `VITE_LLM_ENABLE_THINKING` | Anthropic only — bật thinking blocks | `true` |
| `VITE_LLM_ENABLE_WEB_SEARCH` | Anthropic only — khai báo `web_search` tool | `true` |
| `VITE_LLM_SEARCH_PROVIDER` | `firecrawl` / `duckduckgo` / `serpapi` / `brave` | `firecrawl` |
| `VITE_LLM_SEARCH_API_KEY` | API key cho search backend | `""` |
| `LLM_PROXY_URL` | Dev proxy target (server-side only, không prefix) | `https://api.minimax.io/anthropic` |

**Thứ tự ưu tiên lúc khởi động** (cao → thấp):

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
  -d '{"VITE_RAPID_API_KEY":"abc...","VITE_LLM_API_KEY":"sk-ant-..."}'
# {"ok":true,"wrote":["VITE_RAPID_API_KEY","VITE_LLM_API_KEY"]}
```

> ⚠️ **Bảo mật:** Tất cả biến `VITE_*` đều được Vite inline vào bundle client. Mọi người dùng trang có thể xem được key (View Source → search `VITE_RAPID_API_KEY`). Chấp nhận được cho dùng cá nhân / demo. Cho production, route qua server proxy (xem mục Tech stack bên dưới) để giữ key bí mật.

## 🔌 Tennis API (RapidAPI — livescore6)

1. Đăng ký gói tại [livescore6 trên RapidAPI](https://rapidapi.com/search/livescore6%20tennis) (host: `livescore6.p.rapidapi.com`).
2. Vào `/settings` → dán `X-RapidAPI-Key` vào ô "RapidAPI Key" → bấm **Test connection** để xác nhận.
3. Quay lại Dashboard, hệ thống sẽ tự động gọi API cho ngày đang chọn. Banner sẽ chuyển sang **Live API** (xanh). Nếu chưa có key, dashboard sẽ hiển thị hướng dẫn mở Settings.

**API workflow** (single call trả về toàn bộ trận trong ngày):

```
GET /matches/v2/list-by-date?Category=tennis&Date=YYYYMMDD&Timezone=7
Host: livescore6.p.rapidapi.com
X-RapidAPI-Key: <key>
```

Response shape: `{ Ts, Stages: [{ Sid, Snm, Cnm, Events: [...] }] }`

- Mỗi `Stage` = một tournament instance (ví dụ "Mubadala DC Open", ATP 500).
- Mỗi `Event` = một match (singles hoặc doubles).
- App tự flatten `Stages → Events` và lọc doubles (UI hiện chỉ hỗ trợ 1v1).

**Timestamps:** API trả về `Esd` dạng `YYYYMMDDHHMMSS` (UTC). Mapper convert sang ISO 8601.

**Score per set:** `Tr1S1..S3` / `Tr2S1..S3` là games mỗi set (string-encoded). Nếu một trong hai cột `≥ 10` → set đó kết thúc 7-6 và giá trị là tiebreak sub-score (dùng trong deciding-set super tiebreak).

**Status mapping:** `Esid=1` → scheduled, `Esid=6` → completed, `Esid≥90` → live (đang chơi set 1/2/3). Có fallback về `Eps` text (`"FT"`, `"NS"`, `"S1"`, …) cho các status khác.

**Không được expose bởi API này:** country, round, court, surface, ranking, seed. Mapper dùng placeholder:
- `country` → `""`, flag → `🏳️`
- `round` → `"—"`
- `court` → `undefined`
- `surface` → `"hard"` (default)
- Nếu cần data chi tiết hơn, cân nhắc provider khác hoặc gọi thêm endpoint odds/H2H.

**Rate limit & cache:**
- List-by-date: cache 30 phút. Mỗi lần bấm Refresh trong cùng cache window = 0 request.
- Polling: **mặc định "No Poll" (= 0)** — app không tự fetch, chỉ gọi khi user bấm Refresh. Tối ưu cho quota 500 requests/tháng của RapidAPI (livescore6). Có thể bật lại 1/5/10/15/30 phút nếu cần theo dõi real-time.
- Worst case: 1 call/refresh. "No Poll" + manual 3-4 buổi/tuần × 2h × 5 refresh = ~40 calls/tuần ≈ **160 calls/tháng** (dư ~340 cho edge cases).

> ⚠️ **Bảo mật:** API key hiện lưu local trong trình duyệt và gửi trực tiếp từ client. Cho production, route qua server proxy (Vite middleware / serverless function) để giữ key bí mật.

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
- [x] Live data từ RapidAPI livescore6 (single call: `/matches/v2/list-by-date`)
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

Đổi API host/endpoint: Edit `src/api/tennis.ts` (hằng `API_HOST` + hàm `tennisFetch`).

Cấu hình polling: Vào `/settings` → "Khoảng thời gian (phút)".

Đổi API host/endpoint: Edit `src/api/tennis.ts` (hằng `API_HOST` + hàm `tennisFetch`).

