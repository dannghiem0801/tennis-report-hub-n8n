# Tennis Report Hub

Tennis dashboard cho phóng viên thể thao Việt Nam: xem lịch thi đấu theo ngày, theo dõi trận trong watchlist, sinh báo cáo tiếng Việt tự động (literal fill-in hoặc LLM prompt). Context này bao gồm cả cơ chế auto-on-completion hiện có và cơ chế scheduled batch mới thêm vào.

## Language

**Match**: Một trận đấu tennis (singles) lấy từ RapidAPI flashscore4, đã được mapper chuẩn hóa về shape chung. Là đơn vị dữ liệu cơ bản của app.
_Avoid_: game, fixture, event (event là thuật ngữ riêng của API response)

**Watchlist**: Tập hợp các Match mà user đánh dấu theo dõi. Là nguồn dữ liệu để sinh báo cáo.
_Avoid_: favorites, saved, tracked list

**WatchlistEntry**: Một dòng trong watchlist, gắn với một Match cụ thể. Lưu trạng thái vòng đời (`pending` → `generating` → `completed`/`failed`) cùng snapshot match data tại thời điểm user add. Một entry có thể thuộc về một ScheduledBatch.
_Avoid_: watchlist item, watchlist row

**Report**: Bản báo cáo tiếng Việt được sinh ra cho một WatchlistEntry. Có thể là literal markdown (fill-in từ template) hoặc LLM-generated text. Mỗi Report do một trigger sinh ra (xem `triggeredBy`).
_Avoid_: recap, summary, article (article gợi ý nội dung publish, recap là thể loại bài)

**Auto-on-completion**: Trigger tự động — khi một match trong watchlist chuyển sang trạng thái `completed` (qua polling), hệ thống tự sinh Report cho entry đó. Là cơ chế baseline, chạy mỗi khi detect match xong.
_Avoid_: auto-write, auto-report, completion hook

**Scheduled trigger**: Trigger chủ động — tại một thời điểm do user ấn định (fireAt), hệ thống quét các WatchlistEntry thuộc batch và chỉ force-write những entry đã completed mà chưa có Report (auto-on-completion miss/fail). Match còn `scheduled` hoặc `live` đều bị skip — không viết partial snapshot.
_Avoid_: timer, scheduler, deadline trigger

**ScheduledBatch**: Entity riêng chứa `fireAt` (ISO timestamp) và danh sách `watchlistEntryIds`. Một batch có một fireAt; nhiều entry chia sẻ cùng fireAt. Batch có thể edit (đổi giờ, thêm/bớt entry) hoặc huỷ trước khi fireAt tới. Sau khi chạy → chuyển sang trạng thái terminal (`completed` | `partial` | `cancelled`).
_Avoid_: schedule, scheduled task, timer job

**fireAt**: ISO timestamp gắn trên ScheduledBatch, là thời điểm trigger nên chạy. So sánh với `Date.now()` để quyết định có fire không. Tính bằng local timezone của user (mặc định `Asia/Ho_Chi_Minh`).
_Avoid_: runAt, scheduleTime, triggerTime

**Safety net deadline**: Tính chất của ScheduledBatch trong context hiện tại — scheduled trigger KHÔNG viết report mới, chỉ retry những report auto-on-completion đáng lẽ phải viết mà chưa viết. Tên gọi "deadline" nhấn mạnh vai trò deadline-assurance, không phải snapshot-generation.
_Avoid_: snapshot mode, live trigger

**Batch summary**: Hiển thị sau khi ScheduledBatch chạy xong — danh sách entry với status từng cái (`written` / `already-written` / `skipped-not-ended` / `skipped-cancelled` / `failed`) + thống kê tổng. Hiện trong watchlist tab "Đang chờ" và trong widget góc màn hình.
_Avoid_: batch report, run log

**Retired**: Một dạng completed đặc biệt — match bắt đầu bình thường nhưng một player bỏ cuộc giữa chừng. Match vẫn có data (set score, retirement reason) → Report được sinh, phải nêu rõ lý do retired trong nội dung. Phân biệt với cancelled (chưa chơi) và walkover (thua trước khi vào sân).
_Avoid_: walkover, cancelled (walkover/cancelled là các dạng skipped riêng)

**Cancelled / walkover**: Match không diễn ra hoặc bị huỷ trước khi có data thi đấu thật. Scheduled trigger skip — không sinh Report, không tốn LLM call. Hiển thị trong batch summary dưới status `skipped-cancelled`.
_Avoid_: abandoned (ambiguous giữa cancelled và retired)

**Trigger source** (`triggeredBy` trên Report): Enum cho biết Report này do trigger nào sinh — `"auto-on-completion"` (default, baseline) hoặc `"scheduled-batch"` (safety net force-write). Giúp audit/filter: "Report nào tôi phải tự kiểm tra vì là scheduled force-write?"
_Avoid_: source, origin

**Polling**: Cơ chế fetch data định kỳ từ RapidAPI (mặc định TẮT — `pollingIntervalMinutes: 0` = "No Poll"). Khi bật (1/5/10/15/30 phút), cũng đóng vai trò backup cho setTimeout trong scheduled trigger — mỗi poll kiểm tra batch nào có `fireAt <= now && status === "pending"` để fire.
_Avoid_: refresh, sync, fetch loop

**Template** (`ReportTemplate`): Mẫu để sinh Report. Hai kind: `literal` (markdown với placeholder, fill-in deterministic) hoặc `prompt` (few-shot prompt + glossary, sinh LLM-generated report). Có thuộc tính `isDefault` để chỉ template mặc định khi trigger chạy.
_Avoid_: preset, format, recipe
