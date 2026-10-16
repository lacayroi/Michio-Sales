# Changelog

## M1 — Lead & chia lead (15/10/2026)

**Tiếp nhận & chống trùng (6.2)**
- Một điểm vào cho mọi nguồn (`intakeLead`): chuẩn hóa SĐT, chống trùng theo SĐT / tài khoản kênh / email (khóa advisory theo người, nên webhook gửi trùng song song vẫn chỉ ra 1 lead), "Liên hệ lại" khi đang có lead mở, khách cũ quay lại → sales phụ trách, khách từng thua quay lại → ưu tiên sales cũ.
- Mức ưu tiên tự động theo mức nhập (cấu hình được); lead nóng có hạn nhận 5 phút.
- `POST /api/v1/public/leads` (API key, giới hạn 60 request/phút, honeypot) + **snippet WordPress cho Contact Form 7 và WPForms** (`docs/wordpress-snippet.md`).
- "+ Lead nhanh" luôn hiện trên header (kể cả mobile).
- Import Excel khách sỉ (Phụ lục A): file mẫu, xem trước lỗi từng dòng, chạy nền có tiến độ, gán sales xoay vòng / 1 người / chưa giao. 2.000 dòng dưới 60 giây.
- Gộp hồ sơ khách, có gợi ý (trùng tên + tỉnh, SĐT, email).

**Chia lead (6.3)**
- Engine luật theo thứ tự ưu tiên với điều kiện nguồn, mô hình, mức nhập, nhóm hàng, tỉnh, tag, khung giờ; phương thức xoay vòng / trọng số / ít lead nhất / giao tay; khi hết người: chuyển luật kế tiếp hoặc vào hàng chờ.
- Con trỏ xoay vòng lưu trong DB, chọn người dưới `pg_advisory_xact_lock`. Lọc ứng viên theo trạng thái, nghỉ phép, `maxOpenLeads`, người đã trả/bị thu hồi.
- Thời hạn nhận và liên hệ đầu tiên tính theo giờ làm việc (`addBusinessMinutes`: nghỉ trưa, qua đêm, Chủ nhật, ngày lễ).
- Nhận / Trả / thu hồi khi quá hạn (job `sla-check` đúng hạn + `sla-sweeper` mỗi phút) / tối đa 3 lần rồi vào hàng chờ; cảnh báo quá hạn liên hệ; chế độ HOLD + job 08:00 T2–T7.
- Giao tay và giao hàng loạt; "Thử luật".

**Người dùng (6.1)**
- Màn Người dùng: tạo tài khoản (mật khẩu tạm), sửa vai trò/trạng thái/số lead tối đa, khóa (lead đang chờ được chuyển ngay), **"Đặt lại mật khẩu"** cho Owner/Manager, bắt buộc đổi mật khẩu ở lần đăng nhập kế tiếp. Đổi mật khẩu trong Hồ sơ.

**Màn hình**: S2 Trang chủ Sales (lead chờ nhận có đếm ngược + nút Nhận/Trả lớn, lead chưa liên hệ, việc hôm nay, khách cần nhắc tái đặt, % chỉ tiêu) · Trang chủ Owner/Manager (hàng chờ, quá hạn, lead hôm nay theo nguồn, nhắc xác nhận ngày lễ) · S4 Lead · S5 Chi tiết lead/khách (hồ sơ, sửa, gộp, thời hạn, lịch sử giao, dòng thời gian) · S15 Chia lead · S16 Người dùng · Cài đặt: ngày lễ, API key website · chuông thông báo realtime (SSE).

**Dữ liệu**: migration `m1_leads` (`User.mustChangePassword`, `lead_code_seq`, index). Seed: lịch nghỉ lễ 2026 theo SPEC 1.1 (có 24/11), setting `calendar.holidaysConfirmedYears`.

**Kiểm thử**: 341 unit/integration (Postgres thật qua testcontainers), gồm hai AC bắt buộc: **90 lead song song → 30/30/30** và **20:00 thứ Bảy → hạn nhận 08:10 thứ Hai**; snippet WordPress chạy trong PHP 8.3 với mock; 19 e2e Playwright.

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
