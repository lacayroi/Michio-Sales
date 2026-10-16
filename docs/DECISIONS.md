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

## D-012 · Chia lead đồng bộ trong request, worker lo hạn & quét (M1)
SPEC 6.3.4 đặt engine chia trong queue `assignment`. Đã chọn: `intakeLead` chia lead **ngay trong transaction tạo lead** (cần để `POST /public/leads` trả `assignedTo` theo Phụ lục B và đạt "< 10 giây"). Worker xử lý `sla-check` (job trễ theo `acceptDeadline`, kèm `warn` 3 phút trước hạn), `sla-sweeper` mỗi phút (lưới an toàn) và `out-of-hours-release` 08:00 T2–T7. Queue `assignment` để dành cho kênh vào qua webhook (M3).
- Khóa: `pg_advisory_xact_lock` theo khóa chống trùng (SĐT/email/identity) → mã lead của org → luật. Thứ tự cố định nên không deadlock. 90 lead song song → 30/30/30 (test).
- Hiệu ứng ngoài DB (SSE qua Redis pub/sub, job BullMQ) chạy **sau khi commit** (`EffectBuffer`); mất một hiệu ứng thì sweeper / tải lại trang bù.

## D-013 · Diễn giải luật chia (M1)
- "Thu hồi tối đa 3 lần": được chia lại tối đa `maxReassign` lần; lần thu hồi/trả lại thứ `maxReassign + 1` → hàng chờ + báo Owner/Manager. Trả lại cũng tính vào số lần.
- Người đã trả/bị thu hồi một lead không bao giờ được chia lại chính lead đó (6.3.3), kể cả qua luật kế tiếp.
- Khách đã mua (`orderCount > 0`) → `CUSTOMER_OWNER`, vẫn có bước Nhận + hạn; quá hạn → xoay vòng (loại sales phụ trách). Chỉ bỏ qua sales phụ trách khi `INACTIVE` như SPEC.
- Khách tiềm năng (`PROSPECT`) đi theo lead: giao lead → đổi `Customer.ownerId` (để Sales thấy hồ sơ qua `scopeFilter`). Khách đã có đơn giữ chủ tới khi chuyển giao (M5).
- Giao tay/chuyển bởi Owner/Manager: assignment `ACCEPTED` ngay (không cần bấm Nhận), method `MANUAL` (lead chưa có người) hoặc `TRANSFER`.
- Cuộc gọi/gặp khách đầu tiên của sales được giao = liên hệ đầu tiên (FRT) và tự "Nhận" nếu còn chờ.
- Quá hạn liên hệ đầu tiên: cảnh báo đúng 1 lần (đánh dấu bằng Activity `SYSTEM/CONTACT_OVERDUE`).
- `outOfHoursMode = HOLD`: lead giữ trạng thái `NEW`, job 08:00 chia (bỏ qua ngày lễ). `UNASSIGNED` = hàng chờ giao tay.

## D-014 · SALES tạo lead (M1)
§3 "Tạo lead: SALES tự giao cho mình" mâu thuẫn với 5.3 chế độ A (người trực Zalo công ty có thể là sales, lead cần chia xoay vòng). Mặc định SALES giữ lead (đã nhận); ô "Chia xoay vòng cho sales khác" trong Lead nhanh đưa lead vào luật chia. `POST /leads/quick` nhận thêm `assign: 'auto' | 'self'`.

## D-015 · Import Excel không thêm bảng (M1)
§7 không có model `Import`: bản xem trước tính lại mỗi lần upload; khi xác nhận, các dòng hợp lệ vào job BullMQ `import`, `GET /imports/:id` đọc trạng thái/tiến độ từ job (giữ 7 ngày). Ghi theo lô 250 dòng (2.000 dòng ≈ 4–5 giây). Lead import không có hạn nhận/liên hệ và không bắn thông báo từng lead — mỗi sales nhận 1 thông báo tổng.

## D-016 · `User.mustChangePassword`, quyền `user.view` / `user.resetPassword` (M1)
SPEC 6.1 (1.1) "bắt đổi ở lần đăng nhập sau" cần cờ trên `User` → migration `user_must_change_password`. Manager vào màn Người dùng chỉ để đặt lại mật khẩu (tạo/sửa/khóa vẫn là Owner theo §3) và không đặt lại được mật khẩu Owner.

## D-017 · Kiểm thử tích hợp (M1)
`pnpm test:integration` dùng testcontainers (SPEC §12). Khi Node không tới được Docker (Docker trong WSL trên Windows), đặt `TEST_DATABASE_URL` tới database có tên chứa `test`; global setup chỉ `migrate deploy`, không xóa dữ liệu (mỗi test tạo org riêng).

## D-018 · Build Next.js trên Windows (M1)
`output: 'standalone'` cần tạo symlink; Windows không bật Developer Mode báo EPERM. `next.config.ts` chỉ bật standalone ngoài Windows; Docker image (Linux) không đổi.

## D-019 · API & màn hình bổ sung ngoài §8 (M1)
`GET /customers/:id/timeline`, `GET /customers/:id/merge-suggestions`, `GET/PUT /working-calendar`, `POST /holidays/confirm`, `GET/PUT /company`, `POST /me/password`, `GET /imports/customers` (file mẫu). Trang `/leads/[id]`, `/khach-hang/[id]`, `/khach-hang/import`, `/doi-mat-khau`. `POST /customers` đi qua cùng luồng tiếp nhận (chống trùng) và trả cả `customerId`, `leadId`.
