# Tennis Report Hub

Multi-sport report dashboard cho phóng viên thể thao Việt Nam (hiện hỗ trợ tennis + bóng đá, các môn khác coming soon): xem lịch trận theo ngày, theo dõi trận trong watchlist, sinh báo cáo tiếng Việt tự động (literal fill-in hoặc LLM prompt). Context này bao gồm auto-on-completion hiện có và cơ chế scheduled batch mới thêm vào. Kiến trúc multi-sport được quyết định trong `docs/adr/0002-multi-sport-refactor.md`.

## Multi-sport

**Sport**: Enum cho biết môn thể thao mà một Match thuộc về — `"tennis" | "football" | "basketball"`. Là first-class field trên `Match`, `WatchlistEntry`, `Report`, `ScheduledBatch`, `ReportTemplate`. Mỗi entity thuộc đúng một sport.
_Avoid_: discipline, category (category đã dùng cho TournamentCategory)

**Active sport**: Sport đang được user chọn trên TopBar. Persist trong localStorage + React context, sống xuyên session. Dashboard, watchlist, reports, scheduled batches, templates đều filter theo active sport.
_Avoid_: selected sport, current sport

**Sport-scoped watchlist**: Mỗi sport có watchlist namespace riêng. `WatchlistEntry` thuộc đúng một sport, không cross-mix. Filter ở store level khi render.
_Avoid_: shared watchlist, global watchlist

**Sport-scoped template pool**: Mỗi sport có template pool riêng. Template có field `sport`, auto-on-completion lookup template dựa trên `entry.sport` (không phải active sport). Mỗi sport có đúng một `isDefault: true`.
_Avoid_: shared template pool

## Language

**Match**: Một trận đấu thể thao lấy từ RapidAPI flashscore4, đã được mapper chuẩn hóa về shape chung. Là đơn vị dữ liệu cơ bản của app. Từ v1.5, `Match` là **discriminated union theo `sport`** — xem "Match variants" bên dưới.
_Avoid_: game, fixture, event (event là thuật ngữ riêng của API response)

**Match variants**: Discriminated union theo `sport`. Hai variant hiện tại:
- `TennisMatch` — `sport: "tennis"`, dùng `player1`/`player2` (singles), `sets[]`, `stats` (aces, double faults, break points), `pointByPoint`.
- `FootballMatch` — `sport: "football"`, dùng `home`/`away` (teams), `score` (goals), `events[]` (goals, cards, subs), `halftimeScore`, `stats` (possession, shots, corners).
Common core (id, date, status, tournament, startTime) ở cả hai nhánh.
_Avoid_: monolithic Match, sport-agnostic bag

**Watchlist**: Tập hợp các `Match` mà user đánh dấu theo dõi. Là nguồn dữ liệu để sinh báo cáo. Sport-scoped — mỗi sport có watchlist riêng.
_Avoid_: favorites, saved, tracked list

**WatchlistEntry**: Một dòng trong watchlist, gắn với một `Match` cụ thể. Lưu trạng thái vòng đời (`pending` → `fetching-pbp` → `building-context` → `consolidating` → `completed`/`failed`) cùng snapshot match data tại thời điểm user add. Một entry có thể thuộc về một `ScheduledBatch`. Field `sport` định danh sport; field `side1Name`/`side2Name`/`side1Flag`/`side2Flag` là display label generic (player cho tennis, team cho football).
_Avoid_: watchlist item, watchlist row

**Report**: Bản báo cáo tiếng Việt được sinh ra cho một `WatchlistEntry`. Có thể là literal markdown (fill-in từ template) hoặc LLM-generated text. Mỗi Report do một trigger sinh ra (xem `triggeredBy`). Field `match: Match` là snapshot — variant tùy theo `entry.sport`.
_Avoid_: recap, summary, article (article gợi ý nội dung publish, recap là thể loại bài)

**Auto-on-completion**: Trigger tự động — khi một match trong watchlist chuyển sang trạng thái `completed` (qua polling), hệ thống tự sinh Report cho entry đó. Là cơ chế baseline, chạy mỗi khi detect match xong. Template lookup dựa trên `entry.sport`.
_Avoid_: auto-write, auto-report, completion hook

**Scheduled trigger**: Trigger chủ động — tại một thời điểm do user ấn định (fireAt), hệ thống quét các `WatchlistEntry` thuộc batch và chỉ force-write những entry đã completed mà chưa có Report (auto-on-completion miss/fail). Match còn `scheduled` hoặc `live` đều bị skip — không viết partial snapshot. Mỗi batch là single-sport (entry trong batch cùng sport, enforce bởi `entry.sport` filter).
_Avoid_: timer, scheduler, deadline trigger

**ScheduledBatch**: Entity riêng chứa `fireAt` (ISO timestamp), `sport` (single-sport), và danh sách `watchlistEntryIds`. Một batch có một fireAt; nhiều entry chia sẻ cùng fireAt. Batch có thể edit (đổi giờ, thêm/bớt entry) hoặc huỷ trước khi fireAt tới. Sau khi chạy → chuyển sang trạng thái terminal (`completed` | `partial` | `cancelled`).
_Avoid_: schedule, scheduled task, timer job

**fireAt**: ISO timestamp gắn trên `ScheduledBatch`, là thời điểm trigger nên chạy. So sánh với `Date.now()` để quyết định có fire không. Tính bằng local timezone của user (mặc định `Asia/Ho_Chi_Minh`).
_Avoid_: runAt, scheduleTime, triggerTime

**Safety net deadline**: Tính chất của `ScheduledBatch` trong context hiện tại — scheduled trigger KHÔNG viết report mới, chỉ retry những report auto-on-completion đáng lẽ phải viết mà chưa viết. Tên gọi "deadline" nhấn mạnh vai trò deadline-assurance, không phải snapshot-generation.
_Avoid_: snapshot mode, live trigger

**Batch summary**: Hiển thị sau khi `ScheduledBatch` chạy xong — danh sách entry với status từng cái (`written` / `already-written` / `skipped-not-ended` / `skipped-cancelled` / `failed`) + thống kê tổng. Hiện trong watchlist tab "Đang chờ" và trong widget góc màn hình.
_Avoid_: batch report, run log

**Retired**: Một dạng completed đặc biệt (tennis-specific) — match bắt đầu bình thường nhưng một player bỏ cuộc giữa chừng. Match vẫn có data (set score, retirement reason) → Report được sinh, phải nêu rõ lý do retired trong nội dung. Phân biệt với cancelled (chưa chơi) và walkover (thua trước khi vào sân). Football dùng outcome tương tự nhưng semantics khác — xem "Match outcome".
_Avoid_: walkover, cancelled (walkover/cancelled là các dạng skipped riêng)

**Cancelled / walkover**: Match không diễn ra hoặc bị huỷ trước khi có data thi đấu thật. Scheduled trigger skip — không sinh Report, không tốn LLM call. Hiển thị trong batch summary dưới status `skipped-cancelled`. Áp dụng cho cả tennis và football.
_Avoid_: abandoned (ambiguous giữa cancelled và retired)

**Match outcome**: Sub-state dưới `MatchStatus = "completed"`. Cho biết cách match kết thúc — quyết định có sinh Report hay không. Outcomes:
- `normal` — match kết thúc bình thường (tennis: final set; football: FT).
- `aet` — football only: kết thúc sau extra time, có goal(s) trong ET.
- `pen` — football only: kết thúc bằng penalty shootout, score FT ghi rõ.
- `retired` — tennis only: player bỏ cuộc giữa chừng, data có thật, Report vẫn sinh.
- `walkover` — player/team thua trước khi vào sân, skip Report.
- `cancelled` — match bị huỷ trước khi bắt đầu, skip Report.
- `abandoned` — football only: match bắt đầu nhưng bỏ dở (weather, sự cố), có thể resume. Hiện xử lý như `cancelled` (skip Report) cho đến khi có rule rõ hơn.

_Avoid_: sub-status, end-reason

**Trigger source** (`triggeredBy` trên Report): Enum cho biết Report này do trigger nào sinh — `"auto-on-completion"` (default, baseline) hoặc `"scheduled-batch"` (safety net force-write). Giúp audit/filter: "Report nào tôi phải tự kiểm tra vì là scheduled force-write?"
_Avoid_: source, origin

**Polling**: Cơ chế fetch data định kỳ từ RapidAPI (mặc định TẮT — `pollingIntervalMinutes: 0` = "No Poll"). Khi bật (1/5/10/15/30 phút), cũng đóng vai trò backup cho setTimeout trong scheduled trigger — mỗi poll kiểm tra batch nào có `fireAt <= now && status === "pending"` để fire. Polling áp dụng cho cả tennis và football (mỗi sport có data riêng).
_Avoid_: refresh, sync, fetch loop

**Template** (`ReportTemplate`): Mẫu để sinh Report. Hai kind: `literal` (markdown với placeholder, fill-in deterministic) hoặc `prompt` (few-shot prompt + glossary, sinh LLM-generated report). Field `sport` quyết định pool; field `isDefault` chỉ template mặc định (mỗi sport có đúng một).
_Avoid_: preset, format, recipe

**Participant**: Generic term cho một bên tham gia Match — tennis player hoặc football team. Display fields chung: `name`, `country`, `flag`. Tennis-specific thêm: `ranking`, `seed`. Football-specific thêm: `shortName` (3-letter viết tắt, vd "MUN", "ARS"), `logoUrl`.
_Avoid_: side, contestant, competitor

**ScoreLine**: Generic score representation. Cho tennis: số set thắng mỗi bên. Cho football: số bàn thắng mỗi bên. Dùng cho final score, halftime score (football), setsWon (tennis).
_Avoid_: result, outcome (overloaded với Match outcome)
