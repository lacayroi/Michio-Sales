# Changelog

## M3 — Facebook (17/10/2026)

**Kết nối Page** (SPEC 5.2, thông số Meta đối chiếu ngày 17/10/2026 — D-028)
- `packages/channels/facebook`: Graph API v26.0 (đổi bằng `FB_GRAPH_VERSION`), xác minh `X-Hub-Signature-256`, đọc webhook (tin nhắn, ảnh, tệp, sticker, postback, echo, đã nhận/đã xem, Lead Ads), gửi tin (RESPONSE / HUMAN_AGENT), hồ sơ khách, Lead Ads `field_data`, OAuth lấy page token; `MessageGateway` cho Messenger; client mô phỏng + bộ dựng webhook mẫu (`packages/channels/test/mocks/facebook.ts`).
- Cài đặt → **Facebook Page** (Owner): đăng nhập Facebook → chọn Page → đăng ký webhook cho Page; trạng thái, URL webhook, sự kiện lỗi, ngắt kết nối; bật/tắt thẻ "Nhân viên hỗ trợ". Token lưu mã hóa AES-256-GCM. Job `facebook-token-check` 07:00 hằng ngày, token hỏng → báo Owner.
- Webhook `GET/POST /api/v1/webhooks/facebook` → `WebhookEvent` (gửi trùng chỉ xử lý 1 lần) → queue `channel-inbound`. `pnpm replay:webhook --id …` phát lại sự kiện.

**Tin nhắn → lead tự chia**: khách mới nhắn Page → tạo khách (tên, ảnh từ Facebook) + lead nguồn Messenger → chia xoay vòng như mọi nguồn. Khách đang có lead mở → tin vào hội thoại, báo sales phụ trách tối đa 1 lần/5 phút. Lead Ads → lead nguồn `FACEBOOK_LEAD_ADS` với SĐT, tỉnh, mô hình, mức nhập lấy từ form.

**S6 Hộp thư** (6.4): 3 cột (danh sách lọc Tất cả / Của tôi / Chưa đọc / Chưa trả lời, tìm theo tên/SĐT — khung chat — thẻ khách); mobile: danh sách → chat → nút thông tin khách. Gửi chữ, ảnh, tệp (lưu S3, link ký có hạn), sản phẩm từ danh mục (tìm không dấu); **mẫu trả lời nhanh** gõ `/` có biến `{ten_khach}`, `{ten_sales}`, `{sdt_sales}`; **ghi chú nội bộ** + @nhắc đồng nghiệp; trạng thái gửi (đang gửi / đã gửi / đã nhận / lỗi); **khung 24 giờ**: hết khung khóa ô soạn tin, gợi ý Gọi / Nhắn Zalo / Tạo việc gọi lại. Đổi giai đoạn nhanh từ thẻ khách. Badge chưa đọc trên menu, cập nhật realtime (SSE `message.new`). Chế độ demo có nút "Mô phỏng khách".
- Tin gửi đi qua queue `channel-outbound` (5 lần thử, backoff); tin đầu tiên gửi được tính là **liên hệ đầu tiên** (FRT). Lỗi cuối cùng → báo người gửi.
- Cài đặt → **Mẫu trả lời nhanh** (Owner/Manager). Dòng thời gian khách hiển thị tóm tắt tin nhắn, đổi giai đoạn, việc đã xong.

**Dữ liệu**: migration `m3_search` (`unaccent`, `pg_trgm`, chỉ mục tìm sản phẩm không dấu). Lưu tệp S3 (`packages/core/src/storage.ts`), `GET /api/v1/public/files` cho link ký có hạn.

**Sửa**: `intakeLead` truyền nhầm `displayName` vào khóa tìm danh tính kênh (lỗi tiềm ẩn từ M1, lộ ra khi có nguồn Messenger). Test snippet WordPress chạy được trên Windows có Docker trong WSL (D-035). Test menu e2e chấp nhận số đếm chưa đọc.

**Kiểm thử**: +17 unit kênh Facebook (chữ ký, parser, khung nhắn, Lead Ads, client Graph, gateway), +4 unit (mã hóa, link ký), +10 integration (DoD M3: tin Page → lead tự chia → sales trả lời → liên hệ đầu tiên; webhook trùng → 1 tin 1 lead; tin tiếp theo vào lead đang mở; echo; khung 24 giờ / HUMAN_AGENT; ghi chú @nhắc; phạm vi xem; Lead Ads; lỗi gửi, token hỏng, kiểm tra token), +2 e2e (khách nhắn qua mô phỏng → lead được chia → sales nhận, trả lời bằng mẫu `/chao`, ghi chú; trang cài đặt Facebook).

**Việc của Michio song song**: nộp **Meta App Review** + xác minh doanh nghiệp cho các quyền ở D-028; đặt `FB_APP_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN` và domain HTTPS cho webhook.

## Bổ sung M1 (16/10/2026)
- **Giờ làm việc** sửa được trong Cài đặt (SPEC A1 cần xác nhận) — hạn nhận/liên hệ tính theo giờ mới ngay.
- **Lịch nghỉ nhân viên** (§8 `/users/:id/leaves`): Owner thêm/xóa ở màn Người dùng; người đang nghỉ không được chia lead, lead đang chờ họ được chuyển ngay.
- E2E đặt lại mật khẩu trả mật khẩu về mặc định để các spec sau không phụ thuộc thứ tự chạy.
- Xem D-027 (vì sao giữ bản M1 của PR #1).

## M2 — Zalo Bot (16/10/2026)

**Kết nối** (SPEC 5.5)
- `packages/channels/zalo-bot`: client theo tài liệu chính thức (`bot-api.zaloplatforms.com/bot<TOKEN>/…`: sendMessage ≤ 2.000 ký tự, setWebhook, getUpdates), xác minh header `X-Bot-Api-Secret-Token` (so sánh hằng thời gian), client mô phỏng khi `MOCK_INTEGRATIONS=true`.
- Webhook `POST /api/v1/webhooks/zalo-bot` → `WebhookEvent` (chống trùng theo `message_id`, phát lại được) → queue `zalo-bot-inbound`. Tùy chọn polling `getUpdates` cho máy chưa có HTTPS.
- Liên kết tài khoản: Hồ sơ → "Kết nối Zalo Bot" → mã 6 số (10 phút) → nhắn cho bot. Cài đặt → Zalo Bot cho Owner: trạng thái, đăng ký webhook, ai đã kết nối.

**Lệnh** (không phân biệt hoa thường, có/không dấu): `LEAD`, `NHAN`, `TRA`, `GOI`, `HEN <mã> <dd/mm hh:mm | mai 9h | 15h>`, `XONG`, `HOMNAY`, `TRANGTHAI <mã> TUVAN|BAOGIA|CHOT|THUA [lý do]`, `NGHI`, `LAMVIEC`, `HELP`. Mỗi lệnh gọi đúng service của web với `via = ZALO_BOT` → cùng phân quyền, cùng AuditLog.

**Thông báo qua Zalo**: mọi `Notification` (được giao lead theo mẫu 5.5 có SĐT che + `NHAN/TRA`, thu hồi, khách liên hệ lại — tối đa 1 lần/khách/5 phút, hàng chờ, quá hạn liên hệ) đi qua queue `zalo-bot-notify`; ngoài giờ làm việc hoãn tới giờ mở cửa (trừ loại khẩn); có link mở thẳng trang lead. Mới: "⏰ Còn 3 phút để nhận lead", nhắc việc trước 15 phút, tổng kết 08:00 T2–T7 (Sales: lead chờ nhận/chưa liên hệ, việc hôm nay, khách cần nhắc tái đặt, khách có nguy cơ; Owner/Manager: lead hôm qua theo nguồn, lead chưa xử lý, doanh số tháng vs chỉ tiêu). Người dùng tự tắt từng loại (trừ "được giao lead").

**S18 Hồ sơ**: kết nối bot, cài đặt thông báo, lịch nghỉ, đổi mật khẩu; ở chế độ demo có khung chat mô phỏng Zalo Bot.

**Dữ liệu**: migration `m2_zalo_bot` (`Task.code` tự tăng cho `XONG <mã>`, `User.notificationPrefs`). Service mới: task (tạo/hoàn thành/nhắc), đổi giai đoạn lead (tạo deal khi cần, tự chọn lý do thua theo chữ gõ).

**Sửa**: `pnpm db:deploy` gọi nhầm `pnpm deploy`; global-setup test/e2e gọi `pnpm` bằng `execFileSync` không chạy trên Windows; test snippet WordPress không đọc được file CRLF; `next build` trên Windows không có Developer Mode (D-025).

**Kiểm thử**: +34 unit (parser lệnh, ngày giờ `HEN`), +8 unit client Zalo, +15 integration (DoD M2: LEAD → chia → NHAN/GOI/HEN/XONG/TRA/TRANGTHAI/NGHI qua bot; phân quyền; quy tắc gửi: ngoài giờ, tắt loại, throttle, hết hạn; nhắc việc/“còn 3 phút”/tổng kết sáng đúng 1 lần, bỏ qua ngày lễ; webhook trùng chỉ chạy 1 lần), +2 e2e qua khung chat mô phỏng.

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
