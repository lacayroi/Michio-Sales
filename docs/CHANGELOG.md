# Changelog

## M1 — Lead & chia lead (16/10/2026)

**Tiếp nhận lead & chống trùng (6.2)**
- Một luồng tiếp nhận chung `intakeLead` cho form web, Lead nhanh, nhập tay, import (Facebook/Zalo dùng lại ở M2–M3).
- Chống trùng theo SĐT chuẩn hoá / tài khoản kênh / email; khách đang có lead mở → không tạo lead mới, ghi "Liên hệ lại qua …" và báo sales phụ trách; 2 form gửi đồng thời → 1 khách, 1 lead.
- Khách đã mua quay lại → lead "mua lại" giao thẳng sales phụ trách; khách từng thua → ưu tiên sales cũ.
- Mức ưu tiên tự động theo mức nhập (cấu hình được); nhãn tiếng Việt có/không dấu → mã.
- Gộp hồ sơ khách + gợi ý gộp khi trùng tên + tỉnh.

**Chia lead (6.3)**
- Luật có thứ tự + điều kiện (nguồn, mô hình, mức nhập, nhóm hàng, tỉnh, tag, ưu tiên, khung giờ); xoay vòng / trọng số / ít lead nhất / giao tay; fallback luật kế tiếp / hàng chờ.
- Lọc ứng viên: không AVAILABLE, nghỉ phép, đủ `maxOpenLeads`, đã trả/bị thu hồi lead đó.
- Hạn nhận 10′ (HOT 5′), liên hệ đầu tiên 30′, tính theo giờ làm việc (`addBusinessMinutes`: nghỉ trưa, qua đêm, Chủ nhật, ngày lễ); lead 20:00 thứ 7 → hạn 08:10 thứ 2.
- Nhận / Trả lại / thu hồi khi quá hạn (job trễ + sweeper mỗi phút) / quá 3 lần → hàng chờ + báo Owner; cảnh báo "còn 3 phút"; cảnh báo quá hạn liên hệ; chế độ giữ lead ngoài giờ + job 08:00.
- Giao tay / chuyển từng lead hoặc hàng loạt; lịch sử giao trên trang lead; mọi thay đổi ghi AuditLog.
- "Thử luật": mô phỏng ai nhận và vì sao từng người bị loại, không đổi lượt xoay vòng.

**API**: `/leads` (lọc theo §8), `/leads/quick`, `/leads/:id` + `accept/return/assign/activities/timeline`, `/leads/bulk-assign`, `/customers` (+ `merge`), `/imports/customers` → `/imports/:id`, `/public/leads` (API key, 60 req/phút/key, honeypot), `/users` (+ `deactivate`, `reset-password`, `leaves`), `/assignment-rules` (+ `reorder`, `simulate`), `/settings/:key`, `/holidays`, `/api-keys`, `/notifications`, `/events/stream` (SSE qua Redis pub/sub).

**Giao diện**
- S2 Trang chủ Sales: lead chờ nhận có đếm ngược + nút Nhận/Trả lớn, việc hôm nay, khách cần nhắc tái đặt. Trang chủ Owner: lead chờ giao, lead quá hạn, nhắc xác nhận lịch nghỉ lễ.
- S4 Lead: tab nhanh, bộ lọc, bảng (desktop) / thẻ (mobile), tải thêm, giao hàng loạt; "+ Lead nhanh" luôn hiện (nút nổi trên mobile).
- S5 Chi tiết lead / khách: hồ sơ khách sỉ, nút Gọi + Zalo cạnh SĐT, ghi cuộc gọi/ghi chú, dòng thời gian, lịch sử giao, sửa hồ sơ, gộp.
- S15 Chia lead, S16 Người dùng (tạo, khóa, lịch nghỉ, đặt lại mật khẩu → bắt đổi), S17 Cài đặt (giờ làm việc, ngày lễ + xác nhận năm, thông tin công ty, API key website); import Excel có xem trước lỗi từng dòng và tiến độ.
- Chuông thông báo + cập nhật realtime (SSE).

**Khác**: `docs/wordpress-snippet.md` (Contact Form 7, WPForms, Fluent Forms); migration `user_must_change_password`; sửa script `pnpm db:deploy`.

**Kiểm thử**: 352 unit test, 26 integration test trên Postgres thật (form → chia → hết hạn → thu hồi → chia lại, 90 lead song song 30/30/30, import 2.000 dòng ≈ 5 giây, khách cũ quay lại, gộp, đặt lại mật khẩu), 15 e2e.

**Chưa làm trong M1**: Zalo Bot (M2); hộp thư, webhook Facebook (M3); "đăng xuất mọi thiết bị" (D-003).

## M0 — Nền tảng (15/10/2026)

**Hạ tầng**
- Monorepo pnpm + Turborepo: `apps/web`, `apps/worker`, `packages/{db,core,auth,channels,integrations,pdf,shared}`.
- `docker compose up`: Postgres 16, Redis 7, S3 (SeaweedFS), migrate + seed tự động khi DB trống, web (Next.js standalone), worker (BullMQ).
- ESLint (flat config), TypeScript strict, Vitest, Playwright.

**Dữ liệu**
- Prisma schema đầy đủ theo §7 (+ quan hệ/chỉ mục, xem DECISIONS D-002); migration `init` và trigger AuditLog chỉ-ghi-thêm.
- Seed demo theo Phụ lục C: 7 người dùng (đủ 5 vai trò), lịch T2–T7, ngày lễ, cài đặt §7.1, pipeline, lý do thua, 11 danh mục, 40 sản phẩm, 2 bảng giá sỉ, 60 khách (đủ lifecycle), 80 lead, 25 báo giá, 40 đơn trong 6 tháng, 30 task, 8 hội thoại Messenger, 8 mẫu trả lời nhanh, chỉ tiêu tháng.

**Xác thực & phân quyền**
- Đăng nhập bằng email hoặc SĐT (mọi định dạng VN) + mật khẩu argon2; khóa 15 phút sau 5 lần sai; phiên 30 ngày; đăng xuất.
- `authorize()` / `scopeFilter()` trong `packages/auth`, ma trận quyền §3 có test dạng bảng.
- API: `POST /auth/login`, `POST /auth/logout`, `GET /me`, `PATCH /me/status`, `GET /health`.

**Giao diện**
- Nhận diện Michio (logo, xanh/đỏ, Be Vietnam Pro), dark mode, mobile-first (menu dạng ngăn kéo), manifest PWA + icon.
- Trang đăng nhập; khung ứng dụng có menu lọc theo quyền; trang chủ theo vai trò (Sales / Owner–Manager–Viewer / Support) với số liệu thật; trang "không có quyền"; khung chờ cho các màn hình M1–M5.

**Tiện ích dùng chung**: `normalizeVnPhone`, `maskPhone`, `formatVnd`, `formatDateTime`, khoảng ngày/tháng theo giờ Việt Nam.

**Kiểm thử**: 248 unit test, 10 e2e (đăng nhập 5 vai trò + menu đúng quyền + chặn truy cập trái quyền + mobile).

**Chưa làm trong M0**: quên/đặt lại mật khẩu (D-004).
