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
