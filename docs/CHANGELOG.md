# Changelog

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
