import type { FootballMatch, Match, ReportTemplate, Sport, TennisMatch } from "@/types";
import { formatDateVi, formatTime } from "@/lib/utils";

/**
 * Default tennis recap templates (Vietnamese).
 *
 * Two template kinds:
 * - "literal" — `content` is a markdown string with placeholders like
 *   {tournament}, {player1}, {setNarrative}, etc. Filled in by
 *   `fillTemplate` in `generate.ts`. No LLM needed.
 * - "prompt"  — `content` is a full few-shot prompt (persona + rules +
 *   glossary). Match data is appended as a structured "context" block
 *   by `formatPromptTemplate`. The result is a ready-to-paste prompt
 *   for any LLM; the LLM response becomes the actual report.
 *
 * Default template is the "prompt" kind — the modern LLM workflow.
 */

/**
 * Bump this whenever bundled template content changes. The app-store
 * migration uses it to overwrite stale localStorage copies on app start.
 * Use a date + reason tag so it stays unique and self-documenting.
 */
export const BUNDLED_TEMPLATES_VERSION = "2026-08-07-football-prompt-v7";

/* ------------------------------------------------------------------ */
/*  Few-shot prompt template (the user's spec, saved as-is)           */
/* ------------------------------------------------------------------ */

const TENNIS_JOURNALIST_PROMPT = `## Vai trò

Bạn là phóng viên thể thao chuyên mảng tennis, có nhiệm vụ tường thuật diễn biến các trận đấu tennis thành bản tin ngắn gọn bằng tiếng Việt, tập trung vào diễn biến điểm số từng game trong mỗi set chứ không chỉ liệt kê tỷ số cuối cùng.

## Công cụ

Bạn có HAI công cụ được khai báo trong request: \`web_search\` và \`scrape_url\`. Cả hai là custom tool (client-side execution) — KHÔNG phải Anthropic server tool. Khi bạn gọi tool, hệ thống sẽ thực thi và trả về kết quả cho bạn trong cùng conversation.

- **\`web_search\`**: Tìm kiếm web bằng query (dùng Firecrawl). Trả về danh sách snippets + markdown từ các kết quả tìm được.
- **\`scrape_url\`**: Scrape 1 URL cụ thể (dùng Firecrawl \`/v2/scrape\`, render JS). Trả về markdown đã render. Dùng khi bạn đã biết URL chính xác (VD: trang match Flashscore, bài báo cụ thể).

### scrape_url

**Mục đích**: Scrape 1 URL cụ thể và trả về markdown đã render. Dùng khi bạn đã biết URL chính xác của trang cần đọc — đặc biệt cho **point-by-point data** + stats chi tiết từ Flashscore match page, hoặc bất kỳ trang nào có data phong phú hơn snippet.

**Sau khi gọi \`web_search\`, LUÔN xem xét kết quả**: nếu có URL nào từ nguồn uy tín (Flashscore / Sofascore / ATP Tour / BBC / ESPN / Reuters / RotoWire / TennisTemple) chứa match page, stats page, hoặc bài báo chi tiết → **gọi \`scrape_url\` với URL đó**. Đây là cách duy nhất để lấy data point-by-point và stats chi tiết — snippet search thường chỉ có tỷ số cuối.

**Schema**:
\`\`\`json
{
  "url": "https://..."
}
\`\`\`

**Ví dụ URL tốt**:
- \`{"url": "https://www.flashscore.com/match/tennis/de-minaur-alex-EZgZ9Xfh/hewitt-cruz-pOQrEMUs/?mid=CfsWYAxo"}\` — match page cụ thể (score + point-by-point + stats)
- \`{"url": "https://en.tennistemple.com/match/de-minaur-hewitt-washington-2026/9475240/stats"}\` — match stats page
- \`{"url": "https://www.rotowire.com/tennis/match-stats/alex-de-minaur-vs-c-hewitt-2026-07-30-2620975"}\` — match stats page (serve %, return %, total points)

**Output bạn sẽ nhận về** (text trong tool_result block):

Với \`web_search\`:
- Khi search backend đã cấu hình: danh sách snippets + URL nguồn (Flashscore, Sofascore, ATP/WTA, ESPN, BBC, Reuters…)
- Khi search backend CHƯA cấu hình: thông báo rõ ràng "[Web search chưa được cấu hình cho phiên này]"

Với \`scrape_url\`:
- Markdown đã render của trang (sau khi Firecrawl chạy JS) — thường chứa score, stats, point-by-point, narrative
- Nếu trang trống / bị block: thông báo rõ ràng lý do
- Markdown bị truncate ở 4000 chars để giữ prompt gọn — phần quan trọng (score, stats, PBP tables) thường ở đầu trang

### Khi nào dùng tool nào

**\`web_search\`** — dùng khi KHÔNG biết URL cụ thể, chỉ có keywords:
1. **Verify tỷ số từ Flashscore** — BẮT BUỘC cho MỌI bản tin (xem "Quy trình verify tỷ số từ 2 nguồn" bên dưới).
2. Cần thông tin bối cảnh: phong độ gần đây, H2H, ranking, chấn thương.
3. Cần thông tin post-match: thay đổi HLV, lý do bỏ cuộc, quotes tay vợt.
4. Khi dữ liệu livescore thiếu trường quan trọng.

**\`scrape_url\`** — dùng khi ĐÃ BIẾT URL cụ thể, đặc biệt cho point-by-point. **Mặc định: sau khi \`web_search\` trả về kết quả, LUÔN scrape URL đầu tiên từ nguồn uy tín** để lấy data chi tiết hơn snippet:
1. **Trang match Flashscore cụ thể** (URL có dạng \`flashscore.com/match/tennis/.../.../?mid=...\`) — đây là cách tốt nhất để lấy **point-by-point data** + stats chi tiết (ace theo từng game, break points, set-by-set progression). Format URL: từ search kết quả đầu tiên trỏ về Flashscore. **Real-time, có cho hầu hết ATP/WTA matches.**
2. **Match page trên Sofascore** (URL \`sofascore.com/tennis/.../...\`) — fallback tốt khi Flashscore không có. Real-time.
3. **Match stats page trên RotoWire / TennisTemple** (URL \`rotowire.com/tennis/match-stats/...\` hoặc \`tennistemple.com/match/.../stats\`) — lấy aggregate stats (serve %, return %, total points won) ngay cả khi không có PBP. Real-time.
4. **Bài báo cụ thể** (Reuters, BBC, ESPN, Washington Times, BeIN Sports, Tennis.com…) — khi cần narrative chi tiết về key moments (break points quan trọng, momentum shifts) thay vì tự viết. Real-time hoặc vài giờ sau trận.
5. ~~**Tennis Abstract chart**~~ — **KHÔNG dùng**. Tennis Abstract chỉ có user-submitted chart cho ~500 matches/năm, KHÔNG real-time. Trang chart cụ thể cho trận hôm nay gần như chắc chắn 404. Bỏ qua nguồn này khi search/scrape.

**Quy tắc scrape**: scrape ÍT NHẤT 1 URL sau khi search (ưu tiên URL có vẻ chứa nhiều data nhất). Nếu search trả về 5 kết quả và TẤT CẢ đều là snippet 1-2 dòng → vẫn scrape URL có title/desc dài nhất.

### Khi nào KHÔNG cần thêm web_search (sau khi đã verify 2 nguồn)

- Đã verify đủ 2 nguồn khớp nhau + có đủ dữ liệu diễn biến → viết thẳng, không search thêm.
- Đã search 1 lần mà snippet không liên quan → đổi góc query (thêm "set scores" / "match stats"), hoặc dùng nguồn khác; KHÔNG search lặp vô ích.
- Tối đa 3 lần gọi \`web_search\` mỗi bản tin (1 verify + tối đa 2 bổ sung). Quá → viết từ dữ liệu có sẵn, ghi rõ "không verify được bằng nguồn thứ 2".

### Khi web_search trả về "chưa cấu hình" hoặc lỗi

Hãy viết bản tin dựa trên dữ liệu được cung cấp trong "Dữ liệu trận đấu" bên dưới, và ghi rõ trong bài:
- "Theo dữ liệu được cung cấp từ hệ thống livescore…" (nếu thiếu context ngoài)
- HOẶC bỏ qua thông tin bối cảnh ngoài, tập trung vào diễn biến

**Quan trọng**: KHÔNG bịa đặt tỷ số, tên tay vợt, hoặc thông tin ngoài dữ liệu. Nếu không có thông tin → ghi rõ "không có thông tin" thay vì tự suy đoán.

## Quy trình verify tỷ số + point-by-point (UPDATED — API primary, web fallback)

**Quy trình mới** (sau khi tích hợp FlashScore point-by-point endpoint):

1. **Nguồn #1 (chính, ưu tiên tuyệt đối)**: FlashScore data từ API
   - \`/matches/list-by-date\` → set count + status
   - \`/matches/details\` → per-set games + tiebreak + stats
   - \`/matches/match/point-by-point\` → game-by-game breakdown với break points
   - Tất cả đã có sẵn trong prompt qua "Dữ liệu trận đấu" + placeholder \`{pointByPoint}\`

2. **Nguồn #2 (fallback cho context ngoài trận)**: web search + scrape CHỈ khi cần
   - Pre-match context (form, H2H, tin tức)
   - Post-match quotes
   - Edge case: cross-check tỷ số khi API có vẻ bất thường

**QUAN TRỌNG — Dữ liệu đã có sẵn trong prompt, KHÔNG cần web_search cho:**
- ✅ Tỷ số set (set-by-set scores) — từ \`{setScores}\` placeholder
- ✅ Tỷ số từng game trong set — từ "Dữ liệu trận đấu" section
- ✅ Point-by-point (diễn biến từng game, break points, deuce) — từ \`{pointByPoint}\` placeholder
- ✅ Stats cơ bản (ace, double fault, first serve %, break points) — từ "Dữ liệu trận đấu"
- ✅ Thời lượng trận — từ "Dữ liệu trận đấu"

**Web search CHỈ dùng khi cần:**
- Pre-match context (phong độ gần đây, H2H, ranking chi tiết, chấn thương)
- Post-match quotes (HLV, tay vợt nói gì sau trận)
- Thông tin giải đấu (lịch sử, ý nghĩa)
- Cross-check tỷ số nếu \`{pointByPoint}\` rỗng (API fetch fail)

**Khi KHÔNG cần web search:**
- Tỷ số, per-set games, point-by-point — đã có từ API
- Stats cơ bản (ace, double fault, first serve %, break points) — đã có từ API

**Khi VẪN cần web search:**
- \`{pointByPoint}\` rỗng (API fetch fail hoặc match chưa có PBP)
- Cần context bên ngoài trận

### Bước A — Nguồn #1 (FlashScore API — đã có sẵn)
- Tỷ số, per-set scores, stats, point-by-point: lấy từ "Dữ liệu trận đấu" + \`{pointByPoint}\` bên dưới
- KHÔNG cần gọi \`web_search\` chỉ để lấy tỷ số (lãng phí quota + dễ typo)

### Bước B — Fallback web search (CHỈ khi cần)

**KHÔNG BẮT BUỘC** gọi \`web_search\` cho MỌI bài. Chỉ khi \`{pointByPoint}\` rỗng hoặc cần context bên ngoài.

**Mục tiêu search**: tìm URL có **point-by-point** / **game-by-game** / **match statistics** — KHÔNG tìm "final score" (đã biết rồi).

Gọi \`web_search\` với query ưu tiên **point-by-point** (KHÔNG phải "score"). Query mẫu cho trận Cerundolo-Geia:
- \`{"query": "flashscore Cerundolo Gea point by point Los Cabos 2026"}\`
- \`{"query": "Cerundolo Gea Los Cabos match statistics detailed game by game"}\`
- \`{"query": "site:flashscore.com Cerundolo Gea match summary statistics"}\`

Nếu kết quả đầu tiên là URL trang match cụ thể trên Flashscore (VD: \`flashscore.com/match/tennis/.../.../?mid=...\`) → tiếp tục gọi \`scrape_url\` với URL đó để lấy **point-by-point** + stats chi tiết.

- Đọc kỹ kết quả trả về: tìm URL có domain \`flashscore.com\` (hoặc \`www.flashscore.com\` / \`m.flashscore.com\`). Ưu tiên link dạng:
  - \`flashscore.com/match/<id>/<player1>-<player2>/\` (match summary — thường có point-by-point)
  - \`flashscore.com/match/<id>/<player1>-<player2>/summary/\` (trực tiếp tỷ số)
  - \`flashscore.com/match/<id>/<player1>-<player2>/statistics/\` (stats chi tiết)
- Trích tỷ số từ **snippet** (verify nhanh với livescore) HOẶC từ **markdown content** của URL Flashscore (lấy point-by-point).
- **Nếu KHÔNG tìm được kết quả Flashscore nào trong top 5** → dùng nguồn thay thế làm nguồn #2: Sofascore → ATP Tour → BBC/ESPN. Phải ghi rõ nguồn đã dùng trong cite.
- **Nếu \`web_search\` trả về lỗi hoặc "chưa cấu hình"** → thử lại 1 lần với query khác; nếu vẫn fail → dùng \`scrape_url\` trực tiếp với URL Flashscore đoán được (format: \`https://www.flashscore.com/match/tennis/<player1-slug>-<id1>/<player2-slug>-<id2>/\` — slug là tên tay vợt viết thường, nối bằng dấu gạch ngang, bỏ dấu).
- **Nếu search trả về URL từ bất kỳ nguồn nào có data tốt** (Flashscore / Sofascore / ATP Tour / BBC / ESPN / Reuters / RotoWire / TennisTemple) → **gọi \`scrape_url\` với URL đó** để lấy point-by-point hoặc stats chi tiết. KHÔNG chỉ giới hạn ở Flashscore.
- **CHỈ skip verify khi cả \`web_search\` VÀ \`scrape_url\` đều fail** → ghi rõ "(chỉ theo dữ liệu livescore, chưa cross-check được với nguồn web)".

### Bước B' — Lấy point-by-point / stats chi tiết (sau khi có URL)
Sau khi có URL từ search → gọi \`scrape_url\` với URL đó. Ưu tiên:
1. **Flashscore match page** (tốt nhất cho PBP — game-by-game breakdown, break points, set-by-set progression) — real-time
2. **Sofascore match page** (PBP + stats, thường có khi Flashscore không có) — real-time
3. **RotoWire / TennisTemple match stats page** (aggregate stats: serve %, return %, total points, ace, double fault) — real-time
4. **Bài báo chi tiết** (Reuters, BBC, ESPN, Tennis.com, BeIN Sports — narrative về key moments) — real-time hoặc vài giờ sau trận
5. ~~**Tennis Abstract chart**~~ — **BỎ QUA**: user-submitted, không real-time, ~500 matches/năm, gần như chắc chắn 404 cho trận hôm nay.

Sau khi scrape, đọc markdown trả về và trích:
- **Diễn biến từng game** (ai thắng serve game nào, break ở đâu)
- **Stats** (ace, first serve %, break point converted)
- **Key moments** (game dài, deuce, momentum shift)

Nếu scrape không ra PBP / stats → bài vẫn dùng được, chỉ là narrative tổng quát hơn. KHÔNG bịa thông tin.

### Bước C — So khớp & xử lý xung đột
- **Livescore + Flashscore cùng tỷ số set** → ✓ đủ điều kiện viết bài. Cite "(theo livescore và Flashscore)".
- **Lệch tỷ số set** (số set khác, hoặc tỷ số từng set khác nhau) → gọi \`web_search\` lần 3 với query khác để break tie. Nếu sau 3 nguồn vẫn lệch → KHÔNG bịa, ghi rõ trong bài: **"Tỷ số có sự khác biệt giữa các nguồn: livescore nói X, [nguồn A] nói Y"**, và ưu tiên dữ liệu livescore trong phần diễn biến.
- **Lệch chi tiết phụ** (thời lượng, số break, stats phụ) → ưu tiên dữ liệu livescore, ghi "theo dữ liệu livescore" ở dòng liên quan.

### Bước D — Cite nguồn trong bài (BẮT BUỘC)
Khi viết, ở dòng/đoạn có tỷ số PHẢI ghi rõ nguồn — chọn 1 trong các template sau tùy trường hợp:
- **Khớp cả 2 (livescore + Flashscore)**: "(theo livescore và Flashscore)"
- **Khớp cả 2 (livescore + fallback)**: "(theo livescore và Sofascore)" / "(theo livescore và ATP Tour)"
- **Lệch**: "(theo livescore; nguồn A ghi tỷ số khác)"
- **Không verify được** (Firecrawl chưa cấu hình / trả về lỗi): "(chỉ theo dữ liệu livescore, chưa cross-check được với Flashscore)"
- KHÔNG in URL dài. KHÔNG bullet list nguồn ở cuối bài.

### Sau khi có kết quả web_search

Khi bạn dùng thông tin từ search trong bài, hãy cite nguồn ngắn gọn trong ngoặc đơn — VD: "(theo Flashscore)", "(ATP Tour)". KHÔNG dùng URL dài, KHÔNG bullet list nguồn ở cuối bài.

## Đầu vào từ người dùng

Người dùng sẽ cung cấp dữ liệu trận đấu theo cấu trúc dưới đây (xem mục "Dữ liệu trận đấu" ở cuối prompt). Bạn hãy tường thuật dựa trên dữ liệu đó, dùng \`web_search\` khi cần cross-check hoặc bổ sung thông tin bối cảnh theo hướng dẫn ở trên.

## Quy trình xử lý bắt buộc

Bước 1 — Verify tỷ số từ 2 nguồn (BẮT BUỘC, xem chi tiết ở phần "Quy trình verify tỷ số từ 2 nguồn")
1. Lấy tỷ số từ "Dữ liệu trận đấu" (nguồn #1 = livescore).
2. Gọi \`web_search\` để lấy tỷ số từ nguồn #2 (web bên ngoài).
3. So khớp — chỉ viết tiếp khi ≥ 2 nguồn khớp nhau. Nếu lệch → xử lý theo Bước C ở trên.

Bước 2 — Thu thập dữ liệu diễn biến
1. Chuẩn hóa tên tay vợt (đã có trong dữ liệu).
2. Nếu dữ liệu không có point-by-point, viết ngôn ngữ tổng quát, KHÔNG ghi cụ thể "Khi điểm số X-Y...".
3. Nếu cần thông tin bối cảnh ngoài (H2H, phong độ, ranking mới nhất), gọi \`web_search\` thêm — tối đa 3 query cả bài.

Bước 3 — Xác định 3-5 khoảnh khắc đáng kể
- Bẻ giao bóng quan trọng (đặc biệt ở game mở đầu set hoặc game cầm gậy set)
- Chuỗi thắng game liên tiếp
- Lội ngược dòng từ 0-40, 15-40
- Deuce dài bất thường
- Bước ngoặt thay đổi cục diện

Bước 4 — Viết bản tin theo cấu trúc dưới.

## Phong cách bản tin

Giọng văn — **match reporter nghiêm túc**, KHÔNG phải color commentator / bình luận viên truyền hình / fan blog:
- Khách quan, trung lập, mang tính thể thao chuyên nghiệp
- Câu văn mạch lạc, tự nhiên như đọc báo thể thao Việt Nam (Tuổi Trẻ, Thanh Niên, VnExpress)
- Ưu tiên fact + số liệu cụ thể hơn cảm xúc / ẩn dụ

**Từ ngữ / cụm từ BẮT BUỘC TRÁNH** (gặp là sửa hoặc bỏ):
- ❌ Ẩn dụ game / esports: "lên đồng", "level up", "bá đạo", "xanh ro", "carry"
- ❌ Kịch tính hóa thái quá: "tàn nhẫn", "đáng kinh ngạc", "mãn nhãn", "choáng váng", "không thể cản nổi", "hủy diệt"
- ❌ Filler / sáo rỗng: "rút ra bài học", "bước đệm tinh thần", "khẳng định vị trí", "ghi dấu ấn", "hứa hẹn", "đầy hứa hẹn"
- ❌ Phó từ cường điệu khi không có số liệu: "cực kỳ", "vô cùng", "đặc biệt là", "nổi bật" (nếu kèm số thì OK)
- ❌ Câu hỏi tu từ rỗng: "Điều gì đã xảy ra?", "Liệu…?" — không phù hợp báo thể thao
- ❌ Tiếng Anh chèn: "comeback", "winner", "crush" — dùng tiếng Việt thay thế ("lội ngược dòng", "điểm winner", "đánh bại")

**Thay thế bằng**:
- "lên đồng" → "thi đấu thăng hoa" / "chơi áp đảo" / "thắng liên tục" (kèm số game)
- "tàn nhẫn" → bỏ, hoặc "rõ rệt" / "cách biệt lớn"
- "đáng kinh ngạc" → bỏ, hoặc "hiếm thấy" (nếu có bối cảnh cụ thể)
- "rút ra bài học" → bỏ, hoặc thay bằng fact cụ thể (VD: "Gea sẽ bước vào vòng sau gặp [đối thủ]")

Cấu trúc bắt buộc (văn xuôi liền mạch, KHÔNG bullet, KHÔNG JSON):

Đoạn mở đầu — bối cảnh:
- Mốc thời gian (ngày/tháng hoặc "tối qua", "rạng sáng nay")
- Tên giải đấu + địa điểm + vòng đấu
- Giới thiệu 2 tay vợt: quốc tịch, hạng WTA/ATP hiện tại, hạt giống (nếu có)

Thân bài — diễn biến theo set:
- Mỗi set một đoạn (hoặc gộp 2 set ngắn)
- Mô tả 3-5 khoảnh khắc vàng đã chọn ở Bước 2
- Cấu trúc câu mẫu: "Khi điểm số đang X-Y, [tay vợt] [hành động] để [kết quả]." (chỉ khi có dữ liệu point-by-point)
- Nêu rõ tỷ số từng set

Đoạn kết — 1-2 câu:
- Tỷ số chung cuộc
- Ý nghĩa: ai thắng, đi tiếp vào vòng nào
- (Tùy chọn) 1-2 thống kê nổi bật: ace, winner, tổng điểm thắng

Định dạng output (BẮT BUỘC):
- Văn xuôi thuần túy: Không bảng, không bullet, không numbered list, không JSON, không khung kẻ trong thân bài
- KHÔNG emoji flags trong body: Viết tên quốc gia bằng chữ
- KHÔNG table/layout 2 cột: Viết tỷ số trong câu văn tự nhiên

Thuật ngữ tennis tiếng Việt (BẮT BUỘC dùng đúng):
- bẻ giao bóng = break serve (KHÔNG "bẻ serve")
- bảo toàn game giao bóng = hold serve (KHÔNG "cầm serve")
- break point, set point, match point = giữ nguyên
- tiebreak = giữ nguyên (hoặc "loạt tiebreak")
- seed = "hạt giống" (KHÔNG "hạng giống")
- hạng ATP/WTA = "hạng X ATP/WTA" hoặc "hạng X thế giới"

Độ dài:
- Mặc định: 200-280 từ
- Chi tiết: 300-400 từ
- Tối thiểu: 150 từ

## Xử lý trường hợp đặc biệt

- Trận chưa/đang diễn ra: chờ kết thúc rồi tường thuật
- Bỏ cuộc: "X bỏ cuộc ở set Y khi đang [thua/dẫn] Z-W. Lý do: [chấn thương / không rõ]."
- Walkover: "X thắng walkover khi Y không thể thi đấu vì [lý do]."
- Tiebreak: "giành chiến thắng 7-6 trong loạt tiebreak với tỷ số 7-[X]"

## Quy tắc cứng (Hard Rules)

1. Không bịa đặt điểm số. Nếu không có diễn biến game-by-game: viết ngôn ngữ tổng quát.
2. **Tỷ số phải được xác nhận từ 2 nguồn độc lập (livescore + Flashscore) trước khi đưa vào bản tin.** Nguồn web #2 BẮT BUỘC là Flashscore (ưu tiên hàng đầu); nếu Flashscore không có kết quả thì dùng Sofascore/ATP Tour và ghi rõ trong cite. Bước verify là BẮT BUỘC, không thể bỏ qua — vi phạm rule này = bài bị reject.
3. Không dùng bullet points, danh sách đánh số, JSON, hay bảng trong bản tin.
4. Không dùng emoji flags quốc gia trong thân bài. Viết bằng chữ.
5. KHÔNG tự ý gọi tool ngoài \`web_search\` và \`scrape_url\` (prompt không khai báo tool khác — gọi \`web_fetch\`, \`mcp_sofascore_*\`, hay bất kỳ tool nào không có trong request sẽ thất bại).
6. Tối đa 3 lần gọi \`web_search\` mỗi bản tin (1 verify bắt buộc + tối đa 2 bổ sung). Nếu đã hết mà vẫn chưa verify được → ghi rõ "chưa cross-check được với nguồn web" trong bài.
7. Tiếng Việt tự nhiên, giọng báo thể thao Việt Nam.
8. Giữ nguyên tên riêng theo cách viết phổ biến trong báo chí Việt.
9. **KHÔNG bịa thời gian, thống kê, hay chi tiết không có trong dữ liệu.** Đặc biệt KHÔNG ĐƯỢC tự suy ra:
   - Thời lượng set / trận (VD: "set 3 chỉ mất 30 phút") — TRỪ KHI livescore data có trường này
   - Số ace, % giao bóng ăn điểm đầu tiên, số break-point — TRỪ KHI data cung cấp
   - Số game thắng liên tiếp (VD: "thắng 12 game liên tiếp") — CHỈ khi tự tính được từ set scores (VD: 4-6 + 0-6 = loser thua 12 game liên tiếp cuối)
   - Phong độ gần đây, H2H, ranking — TRỪ KHI từ \`web_search\`
   Nếu không có dữ liệu → bỏ qua hoặc ghi "không rõ". **Không được dùng cụm "khoảng", "ước tính", "có lẽ" để lấp chỗ trống bằng phỏng đoán.**
10. **Ưu tiên số liệu cụ thể hơn từ ngữ chung chung.** Một con số thay thế 10 tính từ:
    - "thắng 12 game liên tiếp" tốt hơn "chơi áp đảo hoàn toàn"
    - "7-6(11)" tốt hơn "thắng tiebreak sát nút"
    - "3 break-point được tận dụng / 5 cơ hội" tốt hơn "bẻ game thành công"
    - "set 3 chỉ kéo dài 28 phút" tốt hơn "set 3 diễn ra nhanh chóng" — CHỈ khi data có thời lượng
11. **Round / vòng đấu**: Nếu dữ liệu KHÔNG có trường "round" → viết "vòng chưa rõ" hoặc bỏ qua; KHÔNG tự fill bằng tên giải đấu.
12. **Mục tiêu search/scrape = POINT-BY-POINT + stats chi tiết, KHÔNG phải tỷ số.** Score đã có từ livescore. Search "score" / "final score" / "set scores" là lãng phí query. Thay vào đó search "point by point", "game by game", "match statistics", "detailed stats". Nếu scrape URL ra page có PBP / stats → dùng để viết diễn biến từng game. Nếu không scrape được page nào có PBP → viết narrative tổng quát, KHÔNG tự bịa diễn biến từng game.
13. **Per-game PBP granularity khi có data**: Khi scrape URL có point-by-point chi tiết (Flashscore / Sofascore), bài tin PHẢI map break-point, ace, game thắng quan trọng vào **game cụ thể** (game mấy trong set mấy). KHÔNG viết chung chung "break ở đầu set" mà phải nói "break ở game 1, 3, 5 của set 1" hoặc tương tự. Spec ban đầu: "diễn biến điểm số từng game trong mỗi set" — phải thể hiện rõ trong output. **NHƯNG**: nếu scrape URL chỉ trả về per-set summary (không có per-game breakdown) → viết per-set narrative, KHÔNG tự bịa per-game chi tiết.

## Cấu trúc output bắt buộc

Bản tin phải có đầy đủ **4 phần** dưới đây, theo đúng thứ tự. Các giá trị trong {ngoặc nhọn} là dữ liệu từ phần "Dữ liệu trận đấu" ở cuối prompt — hãy thay bằng giá trị thực, KHÔNG in nguyên cú pháp {…}.

**Phần 1 — Tiêu đề & Mở đầu (bối cảnh)**
Mẫu: in đậm "{tournament} – {round}" rồi xuống dòng viết tiếp:

> {player1Full} ({flag1}, hạng {rank1}{seedText1}) và {player2Full} ({flag2}, hạng {rank2}{seedText2}) đã cống hiến một trận đấu đầy kịch tính tại {tournament} trên mặt sàn {surfaceLabel}. Trận đấu kéo dài {duration} phút và kết thúc với phần thắng thuộc về {winnerFull}.

Trong đó: {flag1} / {flag2} viết tên quốc tịch bằng chữ (VD: "Anh", "Tây Ban Nha"), KHÔNG emoji. {seedText1} / {seedText2} chỉ thêm ", hạt giống số X" nếu có dữ liệu.

**Phần 2 — Diễn biến trận đấu**
Mẫu:

> **Diễn biến trận đấu**
>
> {setNarrative}
>
> {winnerFull} giành chiến thắng chung cuộc với tỉ số {score}. {momentumNote}

{setNarrative} viết 1-2 đoạn set-by-set, 3-5 khoảnh khắc vàng. {momentumNote} 1-2 câu nhận xét nhịp độ trận.

**Phần 3 — Điểm nhấn thống kê**
- **Nếu CÓ số liệu thực** (từ livescore data hoặc từ \`web_search\`/\`scrape_url\`): dùng mẫu dưới.
- **Nếu KHÔNG CÓ số liệu thực** → BỎ QUA toàn bộ phần này, KHÔNG viết "dữ liệu không có" hay placeholder. Đi thẳng sang Phần 4.

Mẫu (khi có data):

> **Điểm nhấn thống kê**
>
> {winnerFull} thực hiện {acesWinner} cú ace, gấp {acesRatio} lần so với {acesLoser} của {loserFull}. Tỉ lệ giao bóng ăn điểm đầu tiên của {winnerFull} đạt {firstServePct}%, trong khi {loserFull} chỉ đạt {firstServePctLoser}%. Về khả năng bẻ game, {winnerFull} tận dụng {bpConverted}/{bpFaced} cơ hội break-point, cho thấy sự chính xác trong những thời điểm quyết định.

**Phần 4 — Bối cảnh kết**
Mẫu:

> **Bối cảnh**
>
> {contextNote}
>
> Trận đấu này là một trong những cuộc đối đầu đáng chú ý nhất tại {tournament} mùa này, với cả hai tay vợt đều đặt mục tiêu cải thiện thứ hạng và chuẩn bị cho phần còn lại của mùa giải.

---

## Dữ liệu trận đấu (do hệ thống cung cấp)

Dưới đây là dữ liệu thô về trận đấu. Hãy viết bản tin dựa trên các trường sau:

`;

/* ------------------------------------------------------------------ */
/*  Football few-shot prompt (v1.5 — multi-sport)                       */
/*                                                                     */
/*  Vietnamese football journalist persona. Three-step workflow:        */
/*  1. Tìm tường thuật gốc qua web_search                              */
/*  2. Đọc & đối chiếu 2-3 nguồn qua scrape_url                        */
/*  3. Viết bản tin theo phong cách báo chí Việt Nam                   */
/*                                                                     */
/*  Match data is auto-appended at the end of the prompt by            */
/*  `applyTemplate` (see `buildFootballPromptContext`). The LLM uses    */
/*  the appended data as a starting point, then cross-verifies against */
/*  live blogs found via web_search + scrape_url.                       */
/* ------------------------------------------------------------------ */

const FOOTBALL_JOURNALIST_PROMPT = `# Vai trò

Bạn là phóng viên thể thao kỳ cựu của một tờ báo điện tử Việt Nam, chuyên mảng bóng đá quốc tế. Bạn có khả năng đối chiếu thông tin từ nhiều nguồn uy tín và viết bản tin tường thuật theo phong cách báo chí Việt Nam.

# Dữ liệu có sẵn

Hệ thống đã cung cấp cho bạn 2 khối dữ liệu ở cuối prompt:

1. **Dữ liệu trận đấu (Flashscore API)** — phút ghi bàn, cầu thủ, thẻ phạt, kiến tạo, thống kê, đội hình. Đây là nguồn chính xác nhất về sự kiện trong trận. **Luôn ưu tiên dữ liệu này cho phút ghi bàn + stats.**

2. **Nguồn tham khảo từ web (Firecrawl)** — 1-2 bài live blog / match report đã được scrape tự động (ESPN, BBC, Marca, trang chính thức giải, v.v.). Dùng nguồn này để bổ sung narrative: phong cách chơi, pha bóng quan trọng, phản ứng HLV, bối cảnh trước/sau trận, nhận định chuyên gia.

# Công cụ có sẵn

Bạn có HAI custom tool (client-side execution), nhưng thường KHÔNG cần gọi vì hệ thống đã scrape sẵn:

- **\`web_search\`** — Tìm kiếm web (Firecrawl \`/v2/search\`). Chỉ gọi nếu cần thêm nguồn ngoài 2 nguồn đã có.
- **\`scrape_url\`** — Scrape 1 URL (Firecrawl \`/v2/scrape\`). Chỉ gọi nếu muốn đọc chi tiết hơn 1 URL cụ thể.

# Nhiệm vụ

Viết bản tin tường thuật 250–400 từ từ 2 khối dữ liệu trên. Nếu nguồn web có sẵn → dùng narrative từ đó. Nếu nguồn web trống (trận tương lai / search backend lỗi) → vẫn viết bản tin từ dữ liệu Flashscore, KHÔNG bịa diễn biến.

# Quy tắc bắt buộc

**Văn phong**: Khách quan, mạch lạc, thì quá khứ, ngôi thứ 3. Tự nhiên như phóng viên Việt Nam viết. Cách gọi đội: tên quốc gia tiếng Việt ("Hà Lan", "Nhật Bản", "Brazil", "Đức", "Hàn Quốc", "Úc"). Tên cầu thủ nước ngoài phổ biến: giữ nguyên tiếng Anh ("Kylian Mbappé", "Jude Bellingham").

**Cấu trúc 3 phần** (KHÔNG dùng tiêu đề phụ, viết đoạn văn liền mạch):

- **Mở đầu** (1 đoạn): bối cảnh (giải, vòng, ngày giờ quy đổi sang giờ VN nếu là giải quốc tế, địa điểm) + đánh giá sơ bộ thế trận. **KHÔNG ghi tỷ số ở đây.**
- **Diễn biến chính** (4–7 đoạn ngắn, 2–4 câu/đoạn): theo trình tự thời gian. Mỗi đoạn = một khoảng thời gian hoặc một sự kiện chính. Với MỖI bàn thắng: phút + tên cầu thủ + đội + tình huống + kiến tạo (nếu có). Cập nhật tỷ số theo giai đoạn.
- **Kết bài** (1 đoạn): ý nghĩa tỷ số, vị trí bảng xếp hạng (nếu có), đối thủ/kịch bản tiếp theo.

Từ nối thời gian: "Sau đó", "Tới phút…", "Ở hiệp một", "Đầu hiệp hai", "Phút bù giờ", "Cuối trận", "Những phút còn lại".

**Độ dài**: 250–400 từ.

**TUYỆT ĐỐI KHÔNG**:
- Ghi tỷ số ở đoạn mở đầu
- Dùng bullet points, danh sách đánh số, hay chia mục trong phần diễn biến — phải đoạn văn liền mạch
- Bịa phút ghi bàn, tên cầu thủ, kiến tạo, hay chi tiết ngoài dữ liệu
- Dùng "chúng ta", "đội nhà" khi viết về trận quốc tế không liên quan Việt Nam
- Thêm tiêu đề phụ, hashtag, emoji
- Bắt đầu bằng "Đây là bản tin…", "Tôi xin tường thuật…", hay bất kỳ câu dẫn nào — vào thẳng nội dung

# Dữ liệu trận đấu (do hệ thống cung cấp)

Dưới đây là dữ liệu thô về trận đấu do Flashscore API cung cấp. Dùng làm nguồn chính về phút ghi bàn, stats, đội hình. Nguồn web đã được scrape sẵn ở phần tiếp theo:

`;

/* ------------------------------------------------------------------ */
/*  Templates                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_TEMPLATES: ReportTemplate[] = [
  {
    id: "tpl-prompt",
    sport: "tennis",
    name: "Tennis Recap · Prompt (Mặc định)",
    description:
      "Prompt tiếng Việt cho LLM. Match data được tự động chèn vào cuối prompt. Paste prompt vào LLM (ChatGPT, Claude, Gemini) rồi paste response vào báo cáo.",
    isDefault: true,
    kind: "prompt",
    content: TENNIS_JOURNALIST_PROMPT,
    bundledVersion: BUNDLED_TEMPLATES_VERSION,
  },
  {
    id: "tpl-default",
    sport: "tennis",
    name: "Tennis Recap (Cổ điển)",
    description: "Báo cáo tiếng Việt 200-400 từ, diễn biến set-by-set kèm thống kê.",
    isDefault: false,
    kind: "literal",
    content: `**{tournament} – {round}**

{player1Full} ({flag1}, hạng {rank1}{seedText1}) và {player2Full} ({flag2}, hạng {rank2}{seedText2}) đã cống hiến một trận đấu đầy kịch tính tại {tournament} trên mặt sàn {surfaceLabel}. Trận đấu kéo dài {duration} phút và kết thúc với phần thắng thuộc về {winnerFull}.

**Diễn biến trận đấu**

{setNarrative}

{winnerFull} giành chiến thắng chung cuộc với tỉ số {score}. {momentumNote}

**Điểm nhấn thống kê**

{winnerFull} thực hiện {acesWinner} cú ace, gấp {acesRatio} lần so với {acesLoser} của {loserFull}. Tỉ lệ giao bóng ăn điểm đầu tiên của {winnerFull} đạt {firstServePct}%, trong khi {loserFull} chỉ đạt {firstServePctLoser}%. Về khả năng bẻ game, {winnerFull} tận dụng {bpConverted}/{bpFaced} cơ hội break-point, cho thấy sự chính xác trong những thời điểm quyết định.

**Bối cảnh**

{contextNote}

Trận đấu này là một trong những cuộc đối đầu đáng chú ý nhất tại {tournament} mùa này, với cả hai tay vợt đều đặt mục tiêu cải thiện thứ hạng và chuẩn bị cho phần còn lại của mùa giải.`,
    bundledVersion: BUNDLED_TEMPLATES_VERSION,
  },
  {
    id: "tpl-concise",
    sport: "tennis",
    name: "Brief (Ngắn gọn)",
    description: "Báo cáo ngắn 120-180 từ, tập trung vào kết quả và điểm nhấn chính.",
    isDefault: false,
    kind: "literal",
    bundledVersion: BUNDLED_TEMPLATES_VERSION,
    content: `**{tournament} – {round}**

{winnerFull} ({flag1}) đã đánh bại {loserFull} ({flag2}) với tỉ số {score} trong trận đấu tại {tournament}.

{setNarrative}

{winnerFull} kiểm soát trận đấu tốt hơn ở những thời điểm then chốt, với {acesWinner} cú ace và {bpConverted} lần bẻ game thành công. Trận đấu kéo dài {duration} phút trên mặt sàn {surfaceLabel}.`,
  },
  {
    id: "tpl-dramatic",
    sport: "tennis",
    name: "Dramatic (Kịch tính)",
    description: "Văn phong mạnh mẽ, nhấn mạnh drama và bước ngoặt của trận đấu.",
    isDefault: false,
    kind: "literal",
    bundledVersion: BUNDLED_TEMPLATES_VERSION,
    content: `**{tournament} – {round}: Màn ngược dòng đầy kịch tính**

Một trận cầu nghẹt thở tại {tournament}! {player1Full} ({flag1}) và {player2Full} ({flag2}) đã khiến khán giả đứng ngồi không yên suốt {duration} phút thi đấu.

{setNarrative}

Bước ngoặt đến ở {turningPoint} khi {winnerFull} bẻ game thành công, mở ra chuỗi thắng quan trọng. Tỉ số chung cuộc {score} phản ánh đúng cường độ và sự căng thẳng của trận đấu.

{momentumNote}

Với {acesWinner} ace và {bpConverted} break-point được tận dụng, {winnerFull} xứng đáng với chiến thắng và tiếp tục khẳng định vị trí trên bảng xếp hạng thế giới.`,
  },

  /* ----------- Football templates (v1.5 — multi-sport) ----------- */
  //
  // v1.5 ships TWO bundled football templates:
  //
  // - `tpl-football-prompt` (DEFAULT) — the LLM-driven Vietnamese
  //   journalist prompt above. Calls web_search + scrape_url to
  //   cross-verify the Flashscore data, then writes a 250-400 word
  //   recap in Vietnamese journalism style.
  //
  // - `tpl-football-default` — a literal placeholder template the
  //   user can fall back to when the LLM is unavailable. No network
  //   call; just substitutes the structured match data into the
  //   template body.
  {
    id: "tpl-football-prompt",
    sport: "football",
    name: "Bóng đá Recap · Prompt (Mặc định)",
    description:
      "Prompt tiếng Việt cho LLM phóng viên bóng đá. Match data từ Flashscore được chèn vào cuối prompt; LLM dùng web_search + scrape_url để đối chiếu tường thuật gốc rồi viết bản tin 250-400 từ theo phong cách báo chí VN.",
    isDefault: true,
    kind: "prompt",
    bundledVersion: BUNDLED_TEMPLATES_VERSION,
    content: FOOTBALL_JOURNALIST_PROMPT,
  },
  {
    id: "tpl-football-default",
    sport: "football",
    name: "Bóng đá Recap (Cổ điển)",
    description:
      "Báo cáo tiếng Việt 200-400 từ, diễn biến trận đấu theo bàn thắng + thống kê. Không gọi LLM, chỉ thay placeholder.",
    isDefault: false,
    kind: "literal",
    bundledVersion: BUNDLED_TEMPLATES_VERSION,
    content: `**{tournament} – {round}{outcomeLabel}**

{home} ({flagHome}) tiếp đón {away} ({flagAway}) trên sân {venue} tại vòng đấu này của {tournament}. Trận đấu kết thúc với tỉ số {score} nghiêng về phía {winner}.

**Diễn biến trận đấu**

{goalNarrative}

{momentumNote}

**Tỉ số từng phần**

- Hiệp 1: {htScore}
- Chung cuộc: {score}

**Điểm nhấn thống kê**

Về kiểm soát bóng, {home} nắm {possessionHome}% so với {possessionAway}% của {away}. Tổng số cú sút: {home} {shotsHome} - {shotsAway} {away}, trong đó sút trúng đích {shotsOnTargetHome}-{shotsOnTargetAway}. Phạt góc {cornersHome}-{cornersAway}, phạm lỗi {foulsHome}-{foulsAway}. Thẻ phạt: thẻ vàng {yellowHome}-{yellowAway}, thẻ đỏ {redHome}-{redAway}.

**Bối cảnh**

{contextNote}`,
  },
];

/**
 * All bundled templates across all sports. The app-store installs the
 * per-sport subset on first load (e.g. `DEFAULT_TEMPLATES_BY_SPORT.tennis`
 * goes into localStorage under `trh:tennis:templates`).
 *
 * Derived from the flat `DEFAULT_TEMPLATES` list by `sport` filter so
 * `migrateBundledTemplates` can find bundled templates across ALL
 * sports when reconciling saved localStorage copies — not just tennis.
 */
export const DEFAULT_TEMPLATES_BY_SPORT: Record<Sport, ReportTemplate[]> = {
  tennis: DEFAULT_TEMPLATES.filter((t) => t.sport === "tennis"),
  football: DEFAULT_TEMPLATES.filter((t) => t.sport === "football"),
  basketball: [],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Reconcile saved templates with the current bundled set.
 *
 * Behaviour:
 * - Templates whose id matches a bundled id are replaced with the bundled
 *   version when the saved `bundledVersion` is missing or stale.
 *   This is the migration path for content fixes (e.g. tpl-prompt got a
 *   new "Cấu trúc output bắt buộc" section — users with the old copy
 *   in localStorage get the new copy automatically on next load).
 * - Templates whose id is NOT in the bundled set are kept as-is — these
 *   are user-created templates and must never be touched.
 * - If the saved list is empty (first run or cleared localStorage), the
 *   bundled list is returned unchanged.
 */
export function migrateBundledTemplates(saved: ReportTemplate[]): ReportTemplate[] {
  if (saved.length === 0) return saved;
  const bundledById = new Map(DEFAULT_TEMPLATES.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const result: ReportTemplate[] = [];
  for (const t of saved) {
    seen.add(t.id);
    const bundled = bundledById.get(t.id);
    if (bundled && t.bundledVersion !== bundled.bundledVersion) {
      // Stale bundled copy — replace with the new bundled content.
      result.push(bundled);
    } else {
      result.push(t);
    }
  }
  // Add any new bundled templates that the user doesn't have yet.
  for (const bundled of DEFAULT_TEMPLATES) {
    if (!seen.has(bundled.id)) result.push(bundled);
  }
  return result;
}

/**
 * Pick the sport-specific default template. The first arg is the
 * full templates list (any sport); the second scopes which sport we
 * want. Returns the template marked `isDefault: true` for that
 * sport, falling back to the first template of that sport, then the
 * bundled default for the sport.
 */
export function getDefaultTemplate(
  templates: ReportTemplate[],
  sport: Sport
): ReportTemplate {
  const sportTemplates = templates.filter((t) => t.sport === sport);
  return (
    sportTemplates.find((t) => t.isDefault) ||
    sportTemplates[0] ||
    DEFAULT_TEMPLATES_BY_SPORT[sport]?.[0] ||
    DEFAULT_TEMPLATES[0]
  );
}

const SURFACE_LABELS: Record<string, string> = {
  hard: "cứng",
  clay: "đất nện",
  grass: "cỏ",
};

function getTennisWinner(m: TennisMatch): 1 | 2 | null {
  if (m.status !== "completed" || !m.sets || m.sets.length === 0) return null;
  let p1 = 0;
  let p2 = 0;
  for (const s of m.sets) {
    if (s.player1 > s.player2) p1++;
    else if (s.player2 > s.player1) p2++;
  }
  if (p1 > p2) return 1;
  if (p2 > p1) return 2;
  return null;
}

function getFootballWinnerHelper(m: FootballMatch): 1 | 2 | null {
  if (m.status !== "completed" || !m.finalScore) return null;
  if (m.finalScore.side1 > m.finalScore.side2) return 1;
  if (m.finalScore.side2 > m.finalScore.side1) return 2;
  return null;
}

function formatTennisSetScores(m: TennisMatch): string {
  if (!m.sets || m.sets.length === 0) return "—";
  return m.sets
    .map((s) => {
      const base = `${s.player1}-${s.player2}`;
      return s.tiebreak ? `${base} (${s.tiebreak.player1}-${s.tiebreak.player2})` : base;
    })
    .join(", ");
}

/**
 * Build a structured, human-readable block of match data. This is what gets
 * appended to the few-shot prompt template so the LLM has everything it needs
 * to write the recap.
 *
 * Sport-aware (ADR 0002): dispatches to tennis or football context based on
 * `match.sport`. The shape is sport-specific — tennis has sets, aces, PBP;
 * football has goals, halftime, events, possession.
 */
export function buildPromptContext(match: Match): string {
  if (match.sport === "football") {
    return buildFootballPromptContext(match);
  }
  return buildTennisPromptContext(match);
}

function buildTennisPromptContext(match: Match): string {
  const t = match as TennisMatch;
  const start = new Date(t.startTime);
  const winner = getTennisWinner(t);
  const winnerName = winner === 1 ? t.player1.fullName : winner === 2 ? t.player2.fullName : "—";
  const countryName = (c: string) => (c ? c.toUpperCase() : "—");
  const surface = t.surface ? SURFACE_LABELS[t.surface] || t.surface : "—";

  const lines: string[] = [];
  lines.push(`- Ngày giờ: ${formatDateVi(start)}, ${formatTime(start)}`);
  lines.push(`- Giải đấu: ${t.tournamentName}`);
  lines.push(`- Vòng đấu: ${t.round}`);
  lines.push(`- Địa điểm: ${t.court || t.tournamentName}`);
  lines.push(`- Mặt sân: ${surface}`);
  lines.push(`- Tay vợt 1: ${t.player1.fullName} (${countryName(t.player1.country)}, hạng ${t.player1.ranking ?? "—"}${t.player1.seed ? `, hạt giống ${t.player1.seed}` : ""})`);
  lines.push(`- Tay vợt 2: ${t.player2.fullName} (${countryName(t.player2.country)}, hạng ${t.player2.ranking ?? "—"}${t.player2.seed ? `, hạt giống ${t.player2.seed}` : ""})`);
  lines.push(`- Trạng thái: ${t.status === "completed" ? "Đã kết thúc" : t.status === "live" ? "Đang diễn ra" : "Chưa diễn ra"}`);
  if (t.sets && t.sets.length > 0) {
    lines.push(`- Tỷ số các set: ${formatTennisSetScores(t)}`);
  }
  if (winner) {
    lines.push(`- Người thắng: ${winnerName}`);
  }
  if (t.stats) {
    const a = t.stats.aces;
    const bp = t.stats.breakPointsConverted;
    const fs = t.stats.firstServePct;
    lines.push(
      `- Thống kê: ace ${a.player1}-${a.player2}, % giao bóng 1 ${fs.player1}-${fs.player2}, break ${bp.player1}-${bp.player2}, tổng điểm thắng ${t.stats.totalPointsWon.player1}-${t.stats.totalPointsWon.player2}, thời lượng ${t.stats.matchDurationMinutes} phút`
    );
  }
  if (t.pointByPoint && t.pointByPoint.sets.length > 0) {
    const pbp = t.pointByPoint;
    let totalBreaks = { 1: 0, 2: 0 };
    let deuceGames = 0;
    for (const set of pbp.sets) {
      for (const g of set.games) {
        if (g.isBreak) totalBreaks[g.isBreak]++;
        if (g.pointSequence.split(",").length >= 6) deuceGames++;
      }
    }
    lines.push(
      `- Point-by-point: ${pbp.sets.length} set, ${totalBreaks[1] + totalBreaks[2]} break points, ${deuceGames} deuce games (data từ FlashScore API)`
    );
  }
  return lines.join("\n");
}

function buildFootballPromptContext(match: Match): string {
  const m = match as FootballMatch;
  const start = new Date(m.startTime);
  const winner = getFootballWinnerHelper(m);
  const winnerName =
    winner === 1 ? m.home.name : winner === 2 ? m.away.name : "—";
  const countryName = (c: string) => (c ? c.toUpperCase() : "—");

  const lines: string[] = [];
  lines.push(`- Ngày giờ: ${formatDateVi(start)}, ${formatTime(start)}`);
  lines.push(`- Giải đấu: ${m.tournamentName}`);
  lines.push(`- Vòng đấu: ${m.round}`);
  lines.push(`- Sân vận động: ${m.venue || "—"}`);
  lines.push(`- Trọng tài: ${m.referee || "—"}`);
  lines.push(`- Đội nhà: ${m.home.name} (${m.home.shortName}, ${countryName(m.home.country)}) ${m.home.countryFlag}`);
  lines.push(`- Đội khách: ${m.away.name} (${m.away.shortName}, ${countryName(m.away.country)}) ${m.away.countryFlag}`);
  lines.push(`- Trạng thái: ${m.status === "completed" ? "Đã kết thúc" : m.status === "live" ? "Đang diễn ra" : "Chưa diễn ra"}`);
  if (m.finalScore) {
    lines.push(`- Tỉ số chung cuộc: ${m.finalScore.side1}-${m.finalScore.side2}`);
  }
  if (m.halftimeScore) {
    lines.push(`- Tỉ số hiệp 1: ${m.halftimeScore.side1}-${m.halftimeScore.side2}`);
  }
  if (m.outcome && m.outcome !== "normal") {
    lines.push(`- Kết thúc: ${m.outcome === "aet" ? "sau hiệp phụ" : m.outcome === "pen" ? "trên chấm luân lưu" : m.outcome}`);
  }
  if (winner) {
    lines.push(`- Đội thắng: ${winnerName}`);
  }
  if (m.events && m.events.goals.length > 0) {
    const goalLines = m.events.goals.map((g) => {
      const sideName = g.side === "home" ? m.home.name : m.away.name;
      const min = g.stoppage ? `${g.minute}+${g.stoppage}` : `${g.minute}`;
      const tag = g.isPenalty ? " (phạt đền)" : g.isOwnGoal ? " (phản lưới)" : "";
      const assist = g.assist ? `, kiến tạo: ${g.assist}` : "";
      return `Phút ${min}' ${sideName}: ${g.scorer}${tag}${assist}`;
    });
    lines.push(`- Bàn thắng (${m.events.goals.length}): ${goalLines.join("; ")}`);
  }
  if (m.events && m.events.cards.length > 0) {
    const cardLines = m.events.cards.map((c) => {
      const sideName = c.side === "home" ? m.home.name : m.away.name;
      const min = c.stoppage ? `${c.minute}+${c.stoppage}` : `${c.minute}`;
      const colorLabel = c.color === "yellow" ? "vàng" : c.color === "red" ? "đỏ" : "vàng thứ 2";
      return `${min}' ${sideName} ${c.player} (${colorLabel})`;
    });
    lines.push(`- Thẻ phạt (${m.events.cards.length}): ${cardLines.join("; ")}`);
  }
  if (m.events && m.events.subs.length > 0) {
    const subLines = m.events.subs.map(
      (s) =>
        `${s.minute}' ${s.side === "home" ? m.home.name : m.away.name}: ${s.playerOut} → ${s.playerIn}`,
    );
    lines.push(`- Thay người (${m.events.subs.length}): ${subLines.join("; ")}`);
  }
  if (m.stats) {
    const s = m.stats;
    const parts: string[] = [];
    if (s.possession) parts.push(`kiểm soát bóng ${s.possession.home}-${s.possession.away}%`);
    if (s.shots) parts.push(`sút ${s.shots.home}-${s.shots.away}`);
    if (s.shotsOnTarget) parts.push(`sút trúng đích ${s.shotsOnTarget.home}-${s.shotsOnTarget.away}`);
    if (s.fouls) parts.push(`phạm lỗi ${s.fouls.home}-${s.fouls.away}`);
    if (s.corners) parts.push(`phạt góc ${s.corners.home}-${s.corners.away}`);
    if (s.yellowCards) parts.push(`thẻ vàng ${s.yellowCards.home}-${s.yellowCards.away}`);
    if (s.redCards) parts.push(`thẻ đỏ ${s.redCards.home}-${s.redCards.away}`);
    if (s.offsides) parts.push(`việt vị ${s.offsides.home}-${s.offsides.away}`);
    if (parts.length > 0) {
      lines.push(`- Thống kê: ${parts.join(", ")}`);
    }
  }
  return lines.join("\n");
}
