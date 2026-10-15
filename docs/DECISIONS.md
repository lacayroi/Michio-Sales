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

## D-004 · Quên / đặt lại mật khẩu dời sang M6 (M0)
Cần SMTP thật và nơi lưu token đặt lại (schema §7 chưa có bảng). Trong lúc chờ, Owner đặt lại mật khẩu cho nhân viên ở màn Người dùng (M1). Route `/auth/forgot` · `/auth/reset` sẽ làm cùng email ở M6.

## D-005 · Diễn giải ma trận quyền §3 (M0)
Ma trận nằm ở `packages/auth/src/permissions.ts`; test dạng bảng `permissions.test.ts` chép độc lập từ SPEC.
- "Giao / chuyển lead: SALES chỉ Trả lại" → `lead.return` chỉ cấp cho SALES (OWN). Owner/Manager dùng `lead.assign`.
- Pipeline (`deal.*`) theo cùng phạm vi với lead (SUPPORT/VIEWER xem, không sửa).
- `quote.approve` (6.6 "cần Owner duyệt"): Owner + Manager, vì 1.5 nói Manager = Owner trừ tích hợp & xóa.
- `product.update`: chỉ Owner — theo §8 (`PATCH /products/:id` "Owner sửa"), §8 ưu tiên hơn mô tả 1.5.
- Task: SUPPORT có task OWN (kế toán/kho có thể được giao việc); VIEWER không có task.
- Báo cáo: `report.view` (SALES = bản thân) và `report.orders` (SUPPORT chỉ báo cáo đơn). Xuất Excel tách `export.reports` / `export.orders`.
- Menu "Khách cần chăm" gắn với `customer.update` (màn hình làm việc của Sales/Owner, không cho vai trò chỉ đọc).

## D-006 · Màu thương hiệu & độ tương phản AA (M0)
Đo trên `logo.png`: xanh `#00A651` (khớp SPEC), đỏ `#EE292F` (SPEC ghi `#E3262E`). Giữ `#E3262E` của SPEC vì gần như không phân biệt bằng mắt và đạt AA với chữ trắng (4.58:1; `#EE292F` chỉ 4.21:1).
Chữ trắng trên `#00A651` chỉ đạt 3.19:1 (< 4.5:1 AA) nên thêm token:
- `--primary: #007F3E` (nền nút/menu đang chọn, chữ trắng 5.1:1), hover `#006B34`.
- `--accent-text: #C81E25` cho chữ đỏ trên nền sáng (5.4:1).
- `#00A651` vẫn dùng cho dải header, viền focus, icon, chấm trạng thái (không phải chữ).
- Dark mode: nút xanh `#00A651` với chữ tối `#04140B` (5.7:1), chữ đỏ `#FF6B70`.
Icon PWA/favicon cắt từ hình tròn của logo hiện có (độ phân giải thấp) — thay khi Michio gửi file gốc (SPEC 10.1).

## D-007 · Dữ liệu seed (M0)
- Thêm 1 tài khoản **MANAGER** (`manager@michio.local`) dù Phụ lục C không liệt kê, để kiểm thử đủ 5 vai trò (DoD M0).
- Ngày lễ: Tết Dương lịch, 30/4, 1/5, Quốc khánh 1/9 + 2/9 (ngày nghỉ kèm do Chính phủ công bố hằng năm — đang giả định 1/9), Tết Nguyên đán & Giỗ Tổ theo âm lịch chỉ có cho 2026–2027. **Owner cần kiểm tra lại** trong Cài đặt.
- `facebook.standardWindowHours = 24`, `facebook.humanAgentWindowDays = 7`: giá trị tạm, phải đối chiếu tài liệu Meta ở M3 (SPEC 0.1.5).
- Seed xóa sạch dữ liệu rồi tạo lại; từ chối chạy khi `NODE_ENV=production` (trừ `SEED_FORCE=1`). `SEED_IF_EMPTY=1` (dùng trong Docker) bỏ qua nếu đã có dữ liệu.

## D-008 · Lưu trữ S3 khi dev: SeaweedFS thay MinIO (M0)
Image `minio/minio` không còn trên Docker Hub. Dùng `chrislusf/seaweedfs` ở chế độ S3, giữ nguyên cổng 9000 và key `minio`/`minio123` trong `.env.example`, nên code S3 (M4) không phải đổi. Production dùng S3 bất kỳ.

## D-009 · CSRF bằng kiểm tra Origin (M0)
SPEC 11.1 yêu cầu chống CSRF. Cookie đã `SameSite=Lax`; thêm middleware: mọi request ghi (POST/PUT/PATCH/DELETE) vào `/api` có cookie phải có header `Origin` cùng host, nếu không trả 403. Endpoint dùng API key / chữ ký (`/public`, `/webhooks`) được miễn.

## D-010 · AuditLog bất biến ở tầng DB (M0)
Migration `audit_log_append_only` thêm trigger chặn `UPDATE`/`DELETE` trên `AuditLog` (6.12 "Không sửa/xóa được").

## D-011 · Đường dẫn màn hình tiếng Việt không dấu (M0)
`/leads`, `/hop-thu`, `/khach-hang`, `/khach-can-cham`, `/bao-gia`, `/don-hang`, `/viec-cua-toi`, `/bao-cao`, `/san-pham`, `/chia-lead`, `/chuyen-giao`, `/nguoi-dung`, `/cai-dat`, `/audit-log`, `/ho-so`, `/khong-co-quyen`. API giữ tiếng Anh theo §8.
