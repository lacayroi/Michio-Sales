# Quyết định kỹ thuật (Decision log)

Ghi lại mọi chỗ lệch hoặc diễn giải SPEC (theo SPEC 0.1.1). Mới nhất ở cuối.

## D-001 · Prisma 6, không dùng Prisma 7+ (M0)
Schema ở SPEC §7 dùng `provider = "prisma-client-js"` và `url = env(...)` trong `datasource` — cú pháp mà Prisma 7 đã bỏ. Pin `prisma@6.19.x` để giữ đúng schema; nâng cấp là một việc riêng.

## D-002 · Bổ sung quan hệ, chỉ mục, ràng buộc vào schema §7 (M0)
Không thêm/bớt cột nào. Chỉ thêm:
- **Quan hệ Prisma (khóa ngoại)** cho các cột `*Id` chính (Customer.owner, Lead.customer/owner, LeadAssignment, Conversation, Message, Deal, Quote, Order, OrderItem.product, Task, Activity, Target, Notification, BotLinkCode, UserLeave, TeamMember.user, PriceListItem.product, Customer.priceList, CustomerIdentity.channelAccount). Cần cho toàn vẹn dữ liệu và để `scopeFilter` lọc hội thoại theo người phụ trách (`customer.ownerId` / `lead.ownerId`). Cột `orgId` chưa nối tới `Organization` (v1 một tổ chức).
- **Unique**: `WorkingCalendar.orgId` (mỗi org 1 lịch), `QuickReply(orgId, shortcut)`, `ApiKey.hash` (tra cứu key).
- **Index**: `User(orgId, phone)` (đăng nhập bằng SĐT), `Customer(orgId, email)`, `Lead(customerId)`, `LeadAssignment(status, acceptDeadline)` (sla-sweeper), `AssignmentRule(orgId, isActive, priority)`, `Conversation(customerId)`, `CustomerIdentity(customerId)`, `UserLeave(userId, startAt)`, `Quote(orgId, ownerId, status)`, `OrderItem(orderId)`, `OrderItem(productId)`, `Activity(leadId, createdAt)`.

## D-003 · Phiên đăng nhập: cookie JWT ký HS256, không dùng Auth.js/Lucia (M0)
SPEC 4.1 cho phép "Auth.js Credentials hoặc Lucia". Lucia đã ngừng phát triển; Auth.js Credentials thêm nhiều lớp không cần cho đăng nhập email/SĐT + mật khẩu. Đã chọn: cookie `msh_session` (httpOnly, SameSite=Lax, Secure khi `APP_URL` là https, 30 ngày) chứa JWT ký bằng `SESSION_SECRET` (thư viện `jose`, chạy được ở middleware edge).
- Mỗi request server **nạp lại user từ DB** → khóa tài khoản / đặt `INACTIVE` / đổi vai trò có hiệu lực ngay (yêu cầu 6.10 "thu hồi đăng nhập ngay").
- Hạn chế: không có bảng phiên nên không "đăng xuất mọi thiết bị" riêng lẻ được; nếu cần sẽ thêm cột phiên bản phiên vào `User` (M6).
- Khóa 15 phút sau 5 lần sai (6.1): bộ đếm trong Redis (`login-fail:<email|sđt>`), hết hạn 15 phút kể từ lần sai đầu.

## D-004 · Đặt lại mật khẩu bởi Owner/Manager ở M1; quên mật khẩu qua email ở M6
~~Ban đầu (M0): dời cả quên/đặt lại mật khẩu sang M6.~~ **SPEC 1.1 (cập nhật 6.1)**: Owner/Manager có nút "Đặt lại mật khẩu" ở màn Người dùng (sinh mật khẩu tạm, bắt đổi ở lần đăng nhập sau) — làm ở M1. Luồng quên mật khẩu qua email (`/auth/forgot`, `/auth/reset`) vẫn ở M6.

## D-005 · Diễn giải ma trận quyền §3 (M0)
Ma trận nằm ở `packages/auth/src/permissions.ts`; test dạng bảng `permissions.test.ts` chép độc lập từ SPEC.
- "Giao / chuyển lead: SALES chỉ Trả lại" → `lead.return` chỉ cấp cho SALES (OWN). Owner/Manager dùng `lead.assign`.
- Pipeline (`deal.*`) theo cùng phạm vi với lead (SUPPORT/VIEWER xem, không sửa).
- `quote.approve` (6.6 "cần Owner duyệt"): Owner + Manager, vì 1.5 nói Manager = Owner trừ tích hợp & xóa.
- `product.update`: chỉ Owner — theo §8 (`PATCH /products/:id` "Owner sửa"), §8 ưu tiên hơn mô tả 1.5.
- Task: SUPPORT có task OWN (kế toán/kho có thể được giao việc); VIEWER không có task.
- Báo cáo: `report.view` (SALES = bản thân) và `report.orders` (SUPPORT chỉ báo cáo đơn). Xuất Excel tách `export.reports` / `export.orders`.
- Menu "Khách cần chăm" gắn với `customer.update` (màn hình làm việc của Sales/Owner, không cho vai trò chỉ đọc).

## D-006 · Màu thương hiệu & độ tương phản AA (M0 → đã đưa vào SPEC 10.1)
Đo trên `logo.png`: xanh `#00A651` khớp SPEC; đỏ đo được `#EE292F`, giữ `#E3262E` của SPEC (gần như không phân biệt bằng mắt, đạt AA với chữ trắng 4.58:1 so với 4.21:1).
Chữ trắng trên `#00A651` chỉ đạt 3.19:1 nên SPEC 10.1 nay quy định: `--brand-green` `#00A651` (dải header, viền, icon), `--brand-green-strong` `#007F3E` (nền nút chính, chữ trắng 5.1:1), `--brand-green-dark` `#006B34` (hover). Code đã đổi tên token theo SPEC.
Ngoài SPEC: `--accent-text: #C81E25` cho chữ đỏ trên nền sáng (5.4:1); dark mode dùng nút `#00A651` với chữ tối `#04140B` (5.7:1), chữ đỏ `#FF6B70`.
Icon PWA/favicon cắt từ hình tròn của logo hiện có (độ phân giải thấp) — thay khi Michio gửi file gốc.

## D-007 · Dữ liệu seed (M0, cập nhật theo SPEC 1.1)
- Tài khoản **MANAGER** `manager@michio.local` — nay đã có trong Phụ lục C.
- **Ngày lễ** (SPEC 6.1): đủ 12 ngày nghỉ hưởng lương, gồm **Ngày Văn hóa Việt Nam 24/11** (từ 2026). Dịp doanh nghiệp được chọn ngày nghỉ seed theo phương án khu vực nhà nước năm 2026:
  - Tết Nguyên đán: 14/02 – 22/02/2026 (Thông báo 9441/TB-BNV) → seed các ngày T2–T7 trong khoảng đó.
  - Giỗ Tổ 10/3 âm lịch rơi vào Chủ nhật 26/4 → nghỉ bù thứ Hai 27/4.
  - Quốc khánh: 2/9 + ngày liền kề **1/9**. Khu vực nhà nước còn hoán đổi thứ Hai 31/8 với thứ Bảy 22/8 — **không** seed vì đó là hoán đổi ngày làm việc, không phải ngày lễ, và Michio làm thứ Bảy.
  - Nguồn: [xaydungchinhsach.chinhphu.vn – lịch nghỉ Quốc khánh 2026](https://xaydungchinhsach.chinhphu.vn/thong-bao-lich-nghi-le-quoc-khanh-2026-119260729092042494.htm), [thuvienphapluat.vn – tổng hợp ngày nghỉ lễ 2026](https://thuvienphapluat.vn/phap-luat-doanh-nghiep/bai-viet/tong-hop-cac-ngay-nghi-le-trong-nam-2026-chi-tiet-19316.html). Báo chí chưa thống nhất về 24/11 → làm theo SPEC.
  - Năm sau (2027) chỉ seed ngày lễ dương lịch; Tết, Giỗ Tổ, ngày liền kề Quốc khánh chưa được công bố → Owner tự thêm.
  - Setting `calendar.holidaysConfirmedYears` (mặc định `[]`): khi năm hiện tại chưa được xác nhận, trang chủ Owner/Manager hiện lời nhắc kiểm tra lịch nghỉ lễ, kèm màn xác nhận (làm ở M1).
- `facebook.standardWindowHours = 24`, `facebook.humanAgentWindowDays = 7`: giá trị tạm, phải đối chiếu tài liệu Meta ở M3 (SPEC 0.1.5).
- Seed xóa sạch dữ liệu rồi tạo lại; từ chối chạy khi `NODE_ENV=production` (trừ `SEED_FORCE=1`). `SEED_IF_EMPTY=1` (dùng trong Docker) bỏ qua nếu đã có dữ liệu.

## D-008 · Lưu trữ S3 khi dev: SeaweedFS (M0 → đã đưa vào SPEC 4.1)
Image `minio/minio` không còn trên Docker Hub. Dùng `chrislusf/seaweedfs:4.48` ở chế độ S3, cổng 9000, key `minio`/`minio123` như `.env.example`. Production dùng dịch vụ S3-compatible bất kỳ.

## D-009 · CSRF bằng kiểm tra Origin (M0)
SPEC 11.1 yêu cầu chống CSRF. Cookie đã `SameSite=Lax`; thêm middleware: mọi request ghi (POST/PUT/PATCH/DELETE) vào `/api` có cookie phải có header `Origin` cùng host, nếu không trả 403. Endpoint dùng API key / chữ ký (`/public`, `/webhooks`) được miễn.

## D-010 · AuditLog bất biến ở tầng DB (M0)
Migration `audit_log_append_only` thêm trigger chặn `UPDATE`/`DELETE` trên `AuditLog` (6.12 "Không sửa/xóa được").

## D-011 · Đường dẫn màn hình tiếng Việt không dấu (M0)
`/leads`, `/hop-thu`, `/khach-hang`, `/khach-can-cham`, `/bao-gia`, `/don-hang`, `/viec-cua-toi`, `/bao-cao`, `/san-pham`, `/chia-lead`, `/chuyen-giao`, `/nguoi-dung`, `/cai-dat`, `/audit-log`, `/ho-so`, `/khong-co-quyen`. API giữ tiếng Anh theo §8.

## D-012 · Mã lead ngắn bằng một sequence Postgres (M1)
`Lead.code` (§7) dùng cho lệnh bot (`NHAN 1234`). Migration `m1_leads` tạo `lead_code_seq` (bắt đầu 1001); seed đẩy sequence qua mã lớn nhất. v1 chỉ có 1 tổ chức nên một sequence chung vẫn bảo đảm `@@unique([orgId, code])` mà không cần khóa. Khi có nhiều tổ chức: chuyển sang bộ đếm theo org.

## D-013 · Thêm cột `User.mustChangePassword` (M1)
SPEC 6.1 (bản 1.1) yêu cầu "sinh mật khẩu tạm, bắt đổi ở lần đăng nhập sau" — §7 chưa có chỗ lưu trạng thái này. Cột được bật khi Owner tạo tài khoản hoặc Owner/Manager đặt lại mật khẩu. Khi bật: mọi trang chuyển về `/doi-mat-khau`, mọi API (trừ `/api/v1/me/*`) trả 403 `PASSWORD_CHANGE_REQUIRED`. Mật khẩu tạm 10 ký tự, không có ký tự dễ nhầm (0/O, 1/l/I), chỉ hiện một lần, không ghi vào log/audit.
Manager chỉ đặt lại được cho Sales/Support/Viewer (không cho Owner/Manager khác); không ai tự đặt lại cho chính mình (dùng "Đổi mật khẩu" trong Hồ sơ). Vì vậy menu "Người dùng" hiện cho cả Manager, nhưng Manager không tạo/sửa/khóa tài khoản (`user.manage` vẫn chỉ Owner).

## D-014 · Side effect sau commit (outbox trong bộ nhớ) (M1)
Service trong `packages/core` không gọi Redis/BullMQ trực tiếp mà ghi vào `Outbox`; chỉ flush **sau khi transaction commit** (lên lịch `sla-check` đúng `acceptDeadline`, phát sự kiện SSE). Rollback thì không có gì lọt ra ngoài. Test dùng `RecordingEffects`, production dùng `createRedisEffects`. Nếu process chết giữa commit và flush thì `sla-sweeper` (mỗi phút) là lưới an toàn cho SLA, đúng như SPEC 6.3.4.
Thông báo "được giao lead / bị thu hồi / khách liên hệ lại / hàng chờ / quá hạn liên hệ" được lưu vào bảng `Notification` và đẩy realtime lên chuông trên web. Gửi qua Zalo Bot làm ở M2, đọc từ chính các bản ghi này.

## D-015 · Ai nhận lead khi người tạo là Sales (M1)
§3 ghi "SALES tạo lead (tự giao cho mình)", nhưng 5.3/5.5 lại cho phép người trực Zalo công ty (có thể là một sales) tạo lead rồi **chia xoay vòng**. Hai cách được hỗ trợ:
- `assignMode = SELF`: sales giữ lead (giao trực tiếp, đã nhận). Mặc định khi nguồn không phải Zalo công ty.
- `assignMode = AUTO`: đưa vào engine chia như mọi lead khác. Mặc định khi nguồn là `ZALO_COMPANY`.
Sales **không** được chọn người khác (`USER`), vì việc đó cần `lead.assign`.

## D-016 · Giao tay / chuyển giao không cần bấm "Nhận" (M1)
Khi Owner/Manager chủ động giao hoặc chuyển (6.3.5), assignment mới tạo ở trạng thái `ACCEPTED` (method `MANUAL`, hoặc `TRANSFER` nếu lead đã có người), lead chuyển `IN_PROGRESS` và bắt đầu đếm hạn liên hệ đầu tiên. Lý do: người quản lý đã quyết định, thêm bước nhận chỉ tạo thêm một vòng thu hồi vô nghĩa. Assignment cũ chuyển `REASSIGNED`.

## D-017 · Vòng thu hồi và phạm vi dữ liệu (M1)
- `Lead.reassignCount` tăng ở **cả** "Trả" và "quá hạn". Khi chạm `maxReassign` (mặc định 3) thì lead vào hàng chờ và báo Owner/Manager.
- Bấm Nhận sau khi đã quá hạn bị từ chối, dù sweeper chưa kịp chạy — tránh hai người cùng tưởng mình đang giữ lead.
- Người từng trả hoặc bị thu hồi một lead không bao giờ được chia lại chính lead đó (6.3.3).
- Khách **chưa có đơn** (PROSPECT) đi theo người giữ lead (`Customer.ownerId` cập nhật mỗi lần giao) để Sales thấy hồ sơ khách trong phạm vi OWN. Khi đã có đơn thì người phụ trách khách cố định (6.7) cho tới khi chuyển giao (M5).
- Khách cũ quay lại: giao thẳng sales phụ trách nếu người đó không `INACTIVE`/`OFF`/đang nghỉ phép. Vẫn giao khi đang `BUSY`, vì đây là khách quen của họ. Ngược lại thì xoay vòng.
- Khách liên hệ lại khi lead đang mở nhưng chưa có người giữ (đang chờ chia): chỉ ghi Activity "Liên hệ lại", chưa có ai để báo.
- Khi một sales bị đặt `INACTIVE`, các lead **đang chờ** họ nhận được chuyển ngay cho người khác. Lead đã nhận giữ nguyên, chờ chuyển giao ở M5.

## D-018 · Import Excel chỉ tạo/cập nhật khách, không tạo lead (M1)
Phụ lục A dùng để "nhập danh sách khách sỉ hiện có". Nếu tạo lead cho 2.000 khách cũ, mỗi lead sẽ có một hạn nhận 10 phút — vô nghĩa. Vì vậy import chỉ:
- Tạo khách mới, hoặc cập nhật khách trùng SĐT (chạy lại không sinh bản trùng).
- Gán sales phụ trách theo cột email; nếu trống thì theo tùy chọn: xoay vòng giữa người nhận của luật mặc định (không làm lệch con trỏ của luật), giao 1 người, hoặc chưa giao.
- Tính `lifecycle`, `nextReorderAt` từ cột ngày đơn gần nhất / số đơn / chu kỳ. Nếu có cột chu kỳ thì khóa chu kỳ, không cho tự tính lại.
- Nhãn không khớp ánh xạ 5.1 thì báo lỗi dòng (khác với form web: form web vẫn nhận lead và ghi `OTHER`, để không mất khách).
- Không có bảng Import trong §7: trạng thái và tiến độ lấy từ job BullMQ (`GET /imports/:id`, giữ 7 ngày). Mỗi khách có AuditLog riêng, kèm một bản tổng.

## D-019 · Realtime: `router.refresh()` thay vì TanStack Query ở M1 (M1)
Các màn hình M1 render ở server (Server Components). SSE (`/api/v1/events/stream`, Redis pub/sub, lọc theo người nhận và vai trò) kích hoạt `router.refresh()` (gộp các sự kiện trong 300 ms), nên đơn giản hơn mà vẫn realtime. TanStack Query (SPEC 4.1) sẽ dùng khi cần cache phía client: hộp thư M3, Kanban M4.

## D-020 · `POST /public/leads` (M1)
- 201 khi tạo lead mới; **200** khi trùng (`duplicate: true`, kèm lead đang mở); **202** `{ok:true}` khi trường honeypot `website` có dữ liệu (không tạo gì, không để lộ lý do cho bot); 401 khi key sai hoặc đã thu hồi; 422 khi thiếu tên/SĐT hợp lệ; 429 khi vượt 60 request/phút/key.
- Chia lead ngay trong request, nên phản hồi có luôn `assignedTo` (Phụ lục B). Trên máy dev: khoảng 140 ms từ form tới lead đã được chia.

## D-021 · Snippet WordPress hỗ trợ cả Contact Form 7 và WPForms (M1)
Plugin form chưa được xác nhận (SPEC 5.1). `docs/wordpress-snippet.md` chứa một mu-plugin hook cả `wpcf7_mail_sent` lẫn `wpforms_process_complete`. Trường được so khớp theo tên (CF7) hoặc nhãn (WPForms), không phân biệt dấu, mở rộng được qua filter. Form gửi được xác định bằng `MICHIO_HUB_FORMS` (khuyến nghị); nếu không khai báo thì dựa vào đường dẫn `/si-hang-nhat/`, `/dang-ky-dai-ly/`. Test chạy **đúng khối PHP trong tài liệu** bằng PHP 8.3 (Docker) với WordPress/CF7/WPForms giả lập, rồi đưa payload vào Sales Hub.

## D-022 · Thông số Zalo Bot đã đối chiếu (M2)
Đối chiếu https://bot.zaloplatforms.com/docs ngày 16/10/2026 (SPEC 0.1.5), gom trong `packages/channels/src/zalo-bot` (`ZALO_BOT`):
- API `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>`, phản hồi `{ok, result, description, error_code}`; mã lỗi 400/401/403/404/408/429.
- `setWebhook {url (HTTPS, không localhost/IP nội bộ), secret_token 8–256 ký tự}`; mỗi request Zalo gửi header `X-Bot-Api-Secret-Token`. `getUpdates` và webhook **loại trừ nhau**.
- Tin tới: `result.event_name` (`message.text.received`, `…image…`, `…sticker…`, `…voice…`, `…unsupported…`), `message.{from.id, chat.id, chat.chat_type, text, message_id, date}`.
- `sendMessage {chat_id, text 1–2000 ký tự}`. Tài liệu **không** nêu hạn mức cụ thể (chỉ có 429) và không có nút bấm → lệnh dạng chữ như SPEC; gửi giới hạn 10 tin/giây ở worker, 429/408/lỗi mạng thì thử lại, 400/401/404 thì dừng.
- Tài liệu không nói Zalo có gửi lại webhook khi lỗi hay không → trả 200 ngay sau khi lưu `WebhookEvent`, xử lý qua queue; tin trùng `message_id` chỉ chạy một lần.

## D-023 · Lệnh bot dùng lại service web; ai được làm gì (M2)
- Mỗi lệnh chạy service của `packages/core` với người dùng đã liên kết làm `actor`, `via = 'ZALO_BOT'`: phân quyền và AuditLog giống hệt web. Core chỉ trả nội dung trả lời; gửi đi qua `packages/channels` (CLAUDE.md).
- `LEAD` luôn đưa vào luật chia (`assignMode = AUTO`, nguồn `ZALO_COMPANY`) — đúng 5.3 chế độ A, kể cả khi người trực là một sales.
- `GOI` với lead đang chờ người gõ lệnh nhận thì tự "Nhận" trước (gọi cho khách tức là đã nhận lead).
- `HEN` tạo Task gán cho chính người gõ, loại suy từ nội dung ("gọi…" → CALL, "báo giá" → SEND_QUOTE…). Ngày giờ hiểu `dd/mm[/yyyy] hh:mm`, `mai 9h`, `hôm nay 15:30`, `15h` (đã qua thì sang mai); `05/01` gõ vào tháng 12 là năm sau. Giờ trống (vd "15") không được hiểu là giờ.
- `TRANGTHAI` cần lead đang xử lý (đã nhận); tạo một Deal cho lead nếu chưa có. `THUA [lý do]` chọn lý do thua gần nhất theo chữ gõ, không khớp thì "Khác". `CHOT` đóng lead là thắng; ghi nhận đơn sỉ trên web ở M4.
- `NGHI` / `LAMVIEC` đổi `AVAILABLE` ↔ `BUSY` (không đụng `OFF` nghỉ phép).
- Mã liên kết là **6 chữ số** (không lẫn với lệnh/mã lead), hạn 10 phút, dùng một lần. Một chat Zalo chỉ gắn một tài khoản; liên kết lại sẽ gỡ khỏi tài khoản cũ.

## D-024 · Thông báo qua Zalo dùng chính bảng Notification (M2)
Như D-014 đã hẹn: mỗi `Notification` mới được đưa vào queue `zalo-bot-notify` sau khi commit; job quyết định gửi / hoãn / bỏ (`prepareBotDelivery`, có test):
- Ngoài giờ làm việc (lịch công ty + ngày lễ), trừ khi `notify.zaloOutsideHours = true`: hoãn tới giờ mở cửa kế tiếp. Loại khẩn gửi ngay: `lead.queued` (lead không ai nhận — "cảnh báo cho Owner"), `lead.expiring`, `system`.
- Tắt theo người dùng (`User.notificationPrefs`, migration `m2_zalo_bot`); "được giao lead" luôn bật (6.12).
- "Khách liên hệ lại": tối đa 1 tin Zalo / lead / người / 5 phút. Cảnh báo "còn 3 phút" quá 10 phút mà chưa gửi được thì bỏ.
- "Còn 3 phút", nhắc việc và tổng kết sáng cũng là `Notification` (hiện cả ở chuông web), chống trùng bằng `type + link`. Tổng kết chạy trong 2 giờ sau `notify.dailyDigestTime`, chỉ ngày làm việc, nên đổi giờ trong Cài đặt có hiệu lực ngay, không cần khởi động lại worker.
- Nội dung "được giao lead" theo mẫu 5.5 (SĐT che `0912***678`); khi sales `NHAN` thì bot trả SĐT đầy đủ để gọi.

## D-025 · Bổ sung `Task.code` (M2)
SPEC 5.5 có lệnh `XONG <mã task>` nhưng `Task.id` là cuid. Thêm `Task.code` tự tăng (`@default(autoincrement())`, unique theo org), hiển thị "việc V12"; parser chấp nhận `12` hoặc `V12`. v1 một tổ chức nên một sequence chung là đủ (như D-012).

## D-026 · Chạy trên Windows (M2)
- `next build` với `output: 'standalone'` cần quyền tạo symlink; Windows không bật Developer Mode báo EPERM. `next.config.ts` chỉ bật standalone ngoài Windows — Docker image (Linux) không đổi.
- Global-setup của test integration/e2e gọi `pnpm` qua `execFileSync` cần `shell: true` trên Windows (`pnpm.cmd`).
- Test snippet WordPress chuẩn hóa CRLF khi đọc `docs/wordpress-snippet.md` (checkout Windows).

## D-027 · Chọn bản M1 và bổ sung phần còn thiếu (M1/M2)
Có hai bản M1 làm song song: PR #1 (`feat/m1-leads`, đã ở `main`) và `feat/m1-leads-assignment`. Giữ **PR #1** vì: chặn mật khẩu tạm ở cả API (403) chứ không chỉ giao diện; snippet WordPress được test bằng PHP thật; test tiêm đồng hồ nên kiểm tra được giờ làm việc thật; nhiều e2e hơn; M2 đã xây trên nó. Nhánh kia giữ lại để tham khảo, không merge.
PR #1 thiếu hai thứ thuộc phạm vi M1 mà bản kia có, nay được bổ sung theo kiến trúc của PR #1:
- **Giờ làm việc** (`/cai-dat/gio-lam-viec`, `GET/PUT /working-calendar`): A1 là `[CẦN XÁC NHẬN]` nên theo 0.1.4 phải đổi được không cần sửa code. Mỗi ngày tối đa 4 khung, tăng dần, không chồng nhau. Có hiệu lực ngay cho mọi hạn SLA mới.
- **Lịch nghỉ** (`CRUD /users/:id/leaves` theo §8, nút "Lịch nghỉ" ở màn Người dùng — Owner): engine đã bỏ qua người đang nghỉ nhưng trước đây không có chỗ nhập. Nghỉ theo ngày trọn vẹn giờ VN; không cho trùng khoảng; thêm lịch nghỉ đang diễn ra thì các lead **đang chờ** người đó nhận được chuyển ngay cho người khác (như khi khóa tài khoản, D-017). Sales xem được lịch nghỉ của mình ở Hồ sơ.
- Chưa port: "thông tin công ty" (dùng in PDF) — làm cùng báo giá ở M4.

## D-028 · Thông số Meta / Messenger đã đối chiếu (M3)
Đối chiếu tài liệu Meta ngày 17/10/2026 (SPEC 0.1.5), gom trong `packages/channels/src/facebook` (`FACEBOOK`):
- Graph API **v26.0** (phát hành 29/07/2026) làm mặc định; `FB_GRAPH_VERSION` ghi đè. v20.0 hết hạn 24/09/2026.
- Webhook: `GET` trả `hub.challenge` khi `hub.mode=subscribe` và `hub.verify_token` khớp; `POST` có `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(body thô, App Secret)>` — so sánh hằng thời gian trên **body thô** (đọc `req.text()` trước khi parse). Meta cần 200 trong ≤ 5 giây, gửi lại nhiều lần khi lỗi, quá 1 giờ thì tự hủy đăng ký → route chỉ lưu `WebhookEvent` rồi trả 200; xử lý ở queue `channel-inbound`. Tin có thể đến sai thứ tự → thời điểm hội thoại chỉ tiến lên (`GREATEST`).
- Khung nhắn: **24 giờ** sau tin cuối của khách; thẻ `HUMAN_AGENT` cho trả lời thủ công **7 ngày**, chỉ dùng cho trường hợp được duyệt → `facebook.useHumanAgentTag` mặc định `false`, gửi bằng `messaging_type=MESSAGE_TAG, tag=HUMAN_AGENT` khi bật và ngoài 24 giờ. Hai số này giữ trong `Setting` như SPEC 7.1 (giá trị tạm của D-007 nay đã xác nhận).
- Lead Ads: thay đổi `field = leadgen` có `leadgen_id`, `page_id`, `form_id`, `ad_id`, `created_time`; dữ liệu lấy bằng `GET /{leadgen_id}?fields=field_data,…` (quyền `leads_retrieval`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list`, `pages_manage_metadata`). Trường chuẩn (`full_name`, `phone_number`, `email`, `city`) và câu hỏi tùy chỉnh tiếng Việt được ánh xạ theo tên đã bỏ dấu.
- Kết nối Page: đăng nhập Facebook của Owner → code → user token dài hạn (`fb_exchange_token`) → `me/accounts` (page token sinh từ user token dài hạn không hết hạn) → Owner chọn Page → `POST /{page-id}/subscribed_apps` (messages, messaging_postbacks, message_echoes, message_deliveries, message_reads, leadgen). Page token lưu mã hóa AES-256-GCM (`ENCRYPTION_KEY`) trong `ChannelAccount.credentials`; danh sách Page chờ chọn chỉ nằm trong Redis 10 phút, cũng mã hóa, không bao giờ gửi token xuống trình duyệt.
- Lỗi Graph: mã 190/102/10/2xx = token hỏng/thiếu quyền → `ChannelAccount.status = ERROR` + cảnh báo Owner (loại `system`, gửi Zalo kể cả ngoài giờ); 1/2/4/17/32/613, 5xx, lỗi mạng = thử lại. Job `facebook-token-check` 07:00 hằng ngày kiểm tra lại token và tự về `ACTIVE` khi đã sửa.

## D-029 · Tin nhắn vào: lead, hội thoại, dòng thời gian (M3)
- PSID đã biết và khách **đang có lead mở** → chỉ thêm `Message` vào hội thoại, không gọi lại `intakeLead` (tránh ghi "Liên hệ lại" cho từng tin). Ngược lại → `intakeLead` (nguồn `FACEBOOK_MESSENGER`, tên + ảnh lấy từ Graph API) nên chống trùng, khách cũ về đúng sales phụ trách, xoay vòng… giống hệt mọi nguồn khác.
- Webhook gửi trùng: `WebhookEvent.eventKey = facebook:message:<mid>` (unique) + `Message @@unique([conversationId, externalMessageId])` → 1 Message, 1 Lead (AC 6.2).
- Báo sales khi khách nhắn lại: loại `lead.recontact`, tối đa **1 thông báo / hội thoại / 5 phút cả trên web lẫn Zalo** (SPEC 5.5 chỉ nói Zalo; chuông web cũng bị spam nếu không giới hạn). Lead vừa tạo không báo thêm vì đã có "được giao lead".
- Dòng thời gian (6.9 "tin nhắn (tóm tắt)"): một Activity `MESSAGE_IN` / `MESSAGE_OUT` cho mỗi chuỗi tin trong 30 phút, cập nhật số tin và câu cuối.
- Echo: tin do chính app gửi (khớp `FB_APP_ID`) bỏ qua; tin nhân viên gõ trong Page inbox / Business Suite được lưu `OUT` để hội thoại đủ, và tính là liên hệ đầu tiên.
- Ghi chú nội bộ = `Message.direction = NOTE` (không bao giờ vào queue gửi). @nhắc: id chọn từ danh sách, hoặc "@Họ Tên" gõ tay (so khớp không dấu).

## D-030 · Tin nhắn ra qua queue, liên hệ đầu tiên khi gửi thành công (M3)
- Web chỉ kiểm tra quyền + khung nhắn rồi tạo `Message(QUEUED, idempotencyKey)`; bấm gửi 2 lần cùng key → 1 tin. Sau commit đưa vào `channel-outbound` (5 lần, backoff mũ). Worker gửi qua `MessageGateway` (`createMessengerGateway`, kiểm tra khung lần nữa lúc gửi).
- `Lead.firstContactAt` đặt khi tin **thực sự gửi được** (SPEC 6.3.4 "tin nhắn ra đầu tiên"), kèm AuditLog `lead.first_contact`.
- Lỗi vĩnh viễn (hết khung, token hỏng, 4xx) → `FAILED` ngay; lỗi tạm → thử lại, lần cuối vẫn lỗi → `FAILED`. Người gửi nhận thông báo `message.failed`.
- Gửi sản phẩm: ảnh (nếu có) + tên, mã, quy cách, link. Gửi tệp: lưu S3 riêng tư, gửi link ký có hạn 7 ngày (D-031). Messenger giới hạn tệp 25 MB.

## D-031 · Lưu tệp riêng tư + link ký có hạn (M3, dùng lại ở M4)
Bucket S3 không public. Tệp được phục vụ qua `GET /api/v1/public/files?k=&e=&s=` với chữ ký HMAC-SHA256 (khóa dẫn xuất từ `ENCRYPTION_KEY`) và thời hạn trong link — đáp ứng 6.6 "link chia sẻ có hạn" cho PDF báo giá và cho Messenger tải tệp đính kèm, không cần public bucket hay presigned URL lộ endpoint S3 nội bộ. Bucket được tự tạo ở lần ghi đầu (dev SeaweedFS).

## D-032 · Tìm sản phẩm không dấu bằng chỉ mục biểu thức (M3/M4)
Migration `m3_search` bật `unaccent` + `pg_trgm`, tạo hàm `f_unaccent()` IMMUTABLE (bọc `unaccent` có từ điển cố định, thay cả đ/Đ) và chỉ mục GIN trigram trên `f_unaccent(name)`, `sku` (SPEC 11.3). Prisma không mô tả được chỉ mục biểu thức nên chúng chỉ có trong SQL migration; `prisma migrate dev` có thể đề nghị xóa — không chấp nhận đề nghị đó.

## D-033 · Hộp thư dùng server render + SSE `router.refresh()`, chưa dùng TanStack Query (M3)
D-019 định dùng TanStack Query cho hộp thư. Thực tế danh sách + luồng tin render ở server (quyền, đánh dấu đã đọc) và SSE `message.new` gọi `router.refresh()` đủ nhanh cho quy mô 3 sales (11.3); tin cũ hơn tải thêm qua `GET /conversations/:id/messages?before=`. Không thêm thư viện. Nếu cần cập nhật lạc quan / offline (PWA, M6) sẽ xem lại.

## D-034 · Endpoint bổ sung ngoài §8 (M3)
- `POST /api/v1/leads/:id/stage {stage, note}`: đổi giai đoạn nhanh từ thẻ khách (6.4) — cùng service với lệnh bot `TRANGTHAI`. M4 thêm `/deals/:id/stage` theo §8 cho Kanban.
- `POST /api/v1/tasks`: tạo việc "gọi lại" khi hết khung nhắn (5.2). CRUD đầy đủ `/tasks` ở M5.
- `GET /api/v1/products` (tìm không dấu) làm sớm cho nút "Gửi sản phẩm"; màn Sản phẩm ở M4.
- `POST /api/v1/dev/facebook` (chỉ khi `MOCK_INTEGRATIONS=true`): mô phỏng khách nhắn Page, đi đúng đường webhook → `WebhookEvent` → xử lý.
- `pnpm replay:webhook --id <WebhookEvent>` (SPEC 11.4): đặt lại `RECEIVED` và đưa vào queue tương ứng (facebook / zalo-bot).

## D-035 · Chạy test trên máy Windows có Docker trong WSL (M3)
Máy dev hiện tại không có `docker.exe` trên PATH của Windows (Docker chạy trong WSL), nên testcontainers không khởi động được và test snippet WordPress không gọi được `docker`.
- Integration test: đặt `TEST_DATABASE_URL` tới một database trống (đã hỗ trợ từ M0), vd tạo `michio_test` trong Postgres của `docker compose`.
- Test snippet WordPress: trên Windows nếu `docker` không chạy được thì gọi `wsl -e docker …` (`-e` để WSL không đưa lệnh qua shell, giữ nguyên `$` trong mã PHP).
- Chromium mới trả về Promise từ `scrollIntoView()`: effect của React phải viết dạng khối, không `() => el.scrollIntoView()` (lỗi "destroy is not a function" chỉ thấy ở bản build).

## D-036 · Thông số WooCommerce đã đối chiếu (M4)
Đối chiếu tài liệu REST API WooCommerce (wc/v3) ngày 17/10/2026 (SPEC 0.1.5), gom trong `packages/integrations/src/woocommerce.ts` (`WOOCOMMERCE`):
- Xác thực HTTP Basic (Consumer Key/Secret, quyền **Read**) qua HTTPS. Phân trang `page` (từ 1) + `per_page` (tối đa 100 theo WordPress REST), tổng trang ở header `X-WP-TotalPages`.
- Đồng bộ phần thay đổi bằng `modified_after` (có từ WooCommerce 5.8) + `dates_are_gmt=true`; lùi lại 10 phút so với lần chạy trước để không mất thay đổi do lệch giờ. Lần đầu (hoặc "Đồng bộ lại toàn bộ") đọc hết.
- Webhook: `X-WC-Webhook-Signature = base64(HMAC-SHA256(body thô, secret))`, so sánh hằng thời gian; khi tạo webhook WooCommerce gửi một request `webhook_id=…` không có chữ ký → trả 200. Webhook **không** ghi dữ liệu từ payload mà xếp một lượt đồng bộ phần thay đổi (gộp theo phút) — một đường xử lý duy nhất, chống giả mạo nội dung.
- Ghép sản phẩm: theo `wooId`, rồi theo SKU (để nối sản phẩm đã có / nhập tay); không có SKU → `woo-{id}` + `needsSku`. Khi website bổ sung SKU thì thay mã tạm; mã đã sửa tay trong Hub được giữ. Đồng bộ **không** đụng các trường sỉ (quy cách thùng, đơn vị, ẩn/hiện khi báo giá) và không lấy giá sỉ (SPEC 5.6).
- Khóa lưu mã hóa trong `ChannelAccount(type=WOOCOMMERCE).credentials`, ưu tiên hơn biến môi trường `WOO_*`. Trạng thái lần đồng bộ (thời điểm, số tạo/cập nhật, lỗi) nằm ở `ChannelAccount.meta`. Lỗi → `ERROR` + báo Owner một lần cho mỗi chuỗi lỗi. Job `woo-sync-tick` mỗi giờ chạy đồng bộ khi đã quá `woo.syncIntervalHours` (6).

## D-037 · Giá sỉ, báo giá, duyệt chiết khấu (M4)
- Bảng giá áp dụng cho khách: `Customer.priceListId` (gán riêng) → bảng giá có `tier` = cấp khách → bảng `SI_1` → bảng đầu tiên; chỉ xét bảng còn hiệu lực. Bậc số lượng: bậc có `minQty` lớn nhất ≤ SL. Dưới SL tối thiểu vẫn báo giá nhưng gắn cờ.
- Sản phẩm chưa có trong bảng giá sỉ: tạm dùng giá lẻ, gắn cờ "chưa có giá sỉ" trên trình tạo và trong dòng báo giá (`priceSource = RETAIL`) để sales hỏi Owner — không chặn báo giá.
- Sales không sửa đơn giá trên báo giá, chỉ thêm **chiết khấu %** theo dòng; vượt `quote.maxExtraDiscountPct` → `PENDING_APPROVAL`, Owner/Manager nhận thông báo, duyệt xong mới gửi được. Người có quyền duyệt tự tạo thì không cần duyệt. Sửa báo giá sẽ xóa duyệt và PDF cũ.
- Hiệu lực tính lại từ lúc **gửi lần đầu** (hết ngày thứ `quote.validDays`); job `quote-expiry` mỗi giờ chuyển `EXPIRED`.
- Gửi lần đầu: deal sang `BAO_GIA` (không lùi giai đoạn; tạo deal cho lead đang xử lý nếu chưa có), một task "Follow-up báo giá" sau `quote.followUpBusinessDays` ngày làm việc (`autoRuleKey = quote-followup:<id>` nên gửi lại không tạo trùng). Khách đồng ý / từ chối / chuyển đơn thì task tự xong.
- Gửi qua Messenger chỉ khi còn khung nhắn; ngoài khung trả lỗi kèm gợi ý tải PDF gửi Zalo. "Tải PDF" = `GET /quotes/:id/pdf?download=1`.
- "Chuyển thành đơn" chấp nhận cả báo giá `SENT` (coi như khách đồng ý), mỗi báo giá tối đa một đơn. "Tạo đơn lặp lại" (6.8) tạo **báo giá nháp** từ đơn cũ với giá hôm nay (giá có thể đã đổi), không tạo thẳng đơn.

## D-038 · PDF báo giá render trong worker (M4)
`@react-pdf/renderer` + font Be Vietnam Pro TTF (SIL OFL, `packages/pdf/fonts`) và logo (`packages/pdf/assets`). Font của `@fontsource` tách subset Latin/Việt nên không dùng được cho PDF. Việc render chạy ở job `quote-pdf` của worker (SPEC §9), không trong Next.js: bundle web không phải mang react-pdf/đường dẫn font. `GET /quotes/:id/pdf` dùng PDF đã lưu (`Quote.pdfKey`, S3 riêng tư); nếu chưa có (vừa sửa) thì xếp job và chờ (~1 giây). Link gửi khách là link ký có hạn (D-031) tới hết hiệu lực báo giá + 30 ngày. Ảnh sản phẩm được tải trước (4 giây/ảnh, chỉ PNG/JPEG); lỗi ảnh không chặn PDF.

## D-039 · Đơn sỉ, chỉ số khách và chu kỳ tái đặt (M4)
- Mỗi lần tạo / hủy đơn, `recomputeCustomerStats` tính lại từ các đơn không hủy: số đơn, doanh số, đơn đầu/cuối, chu kỳ (≥ 3 đơn: trung vị khoảng cách, làm tròn, kẹp 7–120 ngày; ít hơn: `reorder.defaultCycleDays`; chu kỳ đã khóa thì giữ), `nextReorderAt = lastOrderAt + chu kỳ`, lifecycle. Cùng hàm sẽ dùng cho job `customer-lifecycle` (M5).
- Đơn đầu tiên gán sales phụ trách vĩnh viễn nếu khách chưa có; tạo đơn chốt deal đang mở (`CHOT`, lead `WON`). Kéo thẻ Kanban sang "Chốt đơn" mở form tạo đơn thay vì đổi giai đoạn suông (6.5 "Sang CHOT → tạo Đơn sỉ").
- Chiết khấu trên đơn là số tiền theo dòng (đơn ghi nhận thực tế); đơn giá gợi ý theo bảng giá, sửa được.
- Chỉ Owner/Manager/Support cập nhật thanh toán & giao hàng (§3). Giao xong → báo sales. Đơn đã hủy không cập nhật được nữa.
- Số chứng từ `BG-yyyy-NNNNNN` / `DH-yyyy-NNNNNN` từ hai sequence Postgres (giống D-012), năm theo giờ Việt Nam.

## D-040 · Pipeline Kanban (M4)
Deal được tạo ở lần đổi giai đoạn đầu (bot `TRANGTHAI`, thẻ khách, Kanban, gửi báo giá). Để bảng phủ đủ việc đang làm, lead `IN_PROGRESS` chưa có deal hiện ở cột đầu ("Mới") với khóa `lead-<id>`; kéo đi sẽ tạo deal. Sang "Không thành công" bắt buộc chọn lý do (danh sách `LostReason`). Thẻ đã đóng hiện 30 ngày. Mỗi thẻ có ô "Chuyển sang…" thay cho kéo-thả trên điện thoại / bàn phím. Giá trị thẻ = báo giá lớn nhất đã gửi/được đồng ý của deal, không có thì `expectedAmount`.

## D-041 · Thông tin công ty & cấp khách (M4)
- `Organization.profile` (D-027 hẹn ở M4): tên, địa chỉ, hotline, Zalo, website, email, MST, tài khoản ngân hàng, **điều kiện mặc định** in trên báo giá. Màn Cài đặt → Thông tin công ty (Owner/Manager).
- Cấp khách / bảng giá gán riêng chỉ Owner/Manager sửa (`priceList.manage`) trên hồ sơ khách. Tự xếp cấp theo doanh số 90 ngày (6.5) chưa làm vì tên và ngưỡng cấp còn `[CẦN XÁC NHẬN]`.
- Chu kỳ tái đặt sửa tay → khóa (`reorderCycleLocked`); "Tự tính" mở khóa.

## D-042 · Định nghĩa chỉ số và báo cáo (M5)
- Mọi công thức nằm trong `packages/core/src/metrics.ts` (SPEC 6.11), có unit test; báo cáo, trang chủ Owner và tổng kết sáng dùng chung.
- **FRT** tính bằng phút làm việc (`businessMinutesBetween`), chỉ với lead đã liên hệ. **P90** theo nearest-rank.
- **Nhận đúng hạn**: mẫu số = assignment tự động (xoay vòng, trọng số, ít lead, sales phụ trách, sales cũ) đã có kết quả; assignment còn `PENDING` mà chưa tới hạn thì bỏ ra (chưa biết đúng hay trễ), quá hạn thì tính là trễ.
- **Phễu / Nguồn** theo nhóm lead **tạo trong kỳ** (cohort): đã liên hệ = có `firstContactAt` hoặc đã đi xa hơn; báo giá = có báo giá đã gửi hoặc deal ở/qua giai đoạn "Đã gửi báo giá"; tỷ lệ chốt = thắng / (thắng + thua) của nhóm đó. Tỷ lệ chốt ở Tổng quan & So sánh sales theo **ngày đóng deal** như SPEC.
- **Doanh số khách mới** = đơn trùng `firstOrderAt` của khách. **Tỷ lệ quay lại** tính cho quý chứa ngày cuối kỳ.
- Bộ lọc `nguồn` chỉ áp cho chỉ số theo lead/deal (đơn không gắn nguồn). SALES luôn chỉ thấy số của mình (bỏ qua `ownerId` truyền lên); SUPPORT chỉ xem/xuất **Doanh số** và **Sản phẩm** (§3 "đơn hàng").
- Mỗi báo cáo trả cùng một dạng bảng (`summary`, `columns`, `rows`) nên màn hình và Excel dùng một đường; Excel ghi kỳ báo cáo và các ô tổng.
- Biểu đồ: một chuỗi (doanh số theo ngày) dùng `--primary` (#007F3E sáng / #00A651 tối, đã kiểm bằng validator của skill dataviz), cột ≤ 24px, đầu bo 4px, lưới mảnh, tooltip khi rê; bảng số liệu luôn có cạnh biểu đồ.

## D-043 · Job chăm khách (M5)
- `customer-lifecycle` 01:00: tính lại AT_RISK / DORMANT theo thời gian (đơn mới đã được tính ngay ở M4). Khách vừa thành AT_RISK → báo sales phụ trách; Owner thấy số này trong tổng kết 08:00.
- `reorder-reminder` 07:30 T2–T7: task REORDER cho sales phụ trách khi `nextReorderAt − reorder.remindBeforeDays` đã tới; hạn = thời điểm đó (đưa vào giờ làm việc), ghi chú có đơn gần nhất + **5 mặt hàng mua nhiều nhất**; `autoRuleKey = reorder:{khách}:{ngày nextReorderAt}` → mỗi chu kỳ đúng một task dù job chạy lại. Bỏ qua khách DORMANT và sales đã nghỉ việc. Thông báo theo mẫu 5.5 nhưng dùng `XONG <mã việc>` (khách đã mua thường không còn lead mở nên `HEN <mã lead>` không áp dụng).
- `stale-lead` mỗi giờ: lead đang xử lý không có hoạt động quá `lead.staleDays` → báo sales một lần cho mỗi giai đoạn im lặng.
- Ba quy tắc bật/tắt bằng setting mới `automation.quoteFollowUp`, `automation.reorderReminder`, `automation.staleLead` (mặc định bật), sửa ở Cài đặt → Quy tắc tự động cùng các ngưỡng §7.1.
- Báo cáo tuần qua email (`weekly-report`, §9) **dời sang M6** cùng hạ tầng email (quên mật khẩu, D-004).

## D-044 · Chuyển giao (M5)
- Không có bảng Transfer trong §7: như import (D-018), job BullMQ `transfer` giữ tiến độ & kết quả 7 ngày (`GET /transfers/:id`).
- Đơn vị chuyển là **khách**: lead đang xử lý, deal mở, báo giá chưa chốt, việc còn mở đi theo người nhận khách đó; xoay vòng chia đều theo thứ tự tạo khách. Lead **đang chờ nhận** không chuyển tay mà trả về engine chia lead (loại người cũ).
- Lead chuyển tay tạo assignment `TRANSFER` ở trạng thái đã nhận (D-016). Đơn đã ghi nhận giữ nguyên sales cũ để doanh số lịch sử đúng người.
- Chạy theo khối 250 bản ghi/transaction, mỗi bản ghi một dòng AuditLog + một dòng tổng; 1.000 bản ghi ~2 giây trên máy dev. Tùy chọn khóa tài khoản người chuyển ngay (không áp dụng cho Owner). Người nhận được thông báo kèm danh sách khách (web + Zalo Bot).

## D-045 · Chỉ tiêu và các màn hình M5
- Chỉ tiêu tháng (`/targets`, tab Báo cáo → Chỉ tiêu): Owner/Manager đặt doanh số, khách mới, số đơn; thực đạt tính từ đơn không hủy và `firstOrderAt`. Sales xem của mình.
- Việc của tôi (S11): Owner/Manager mặc định xem việc của chính mình (`?mine=0` xem tất cả trong phạm vi). Dời hạn, hủy, hoàn thành; mọi thay đổi có audit.
- Audit log (S19) chỉ đọc, lọc theo đối tượng/hành động/kênh/ngày, hiện thay đổi trước → sau.
- Mọi màn hình trong §10.2 đã có giao diện thật; bỏ component "đang xây dựng".
