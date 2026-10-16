# Runbook

## Chạy local (dev)
```bash
corepack enable                 # pnpm 10 theo packageManager
pnpm install
cp .env.example .env            # đặt SESSION_SECRET (≥16 ký tự), ENCRYPTION_KEY
pnpm infra:up                   # postgres, redis, s3
pnpm db:migrate                 # áp dụng migration
pnpm db:seed                    # dữ liệu demo (XÓA SẠCH dữ liệu cũ)
pnpm dev                        # web :3000 + worker
```
Tài khoản demo: `owner@`, `manager@`, `sale1@`…`sale3@`, `ketoan@`, `viewer@michio.local` — mật khẩu `Michio@123`.

## Chạy toàn bộ bằng Docker
```bash
docker compose up -d --build    # migrate + seed (chỉ khi DB trống) rồi chạy web, worker
curl localhost:3000/api/v1/health
docker compose down -v          # xóa cả dữ liệu
```

## Kiểm thử
```bash
pnpm lint && pnpm typecheck
pnpm test                         # unit + integration
pnpm --filter @michio/web build && pnpm test:e2e
```
- **Integration** (`packages/core/src/*.int.test.ts`) tự khởi động PostgreSQL 16 bằng testcontainers, nên cần Docker. Docker Desktop trên Linux được tự nhận (`~/.docker/desktop/docker.sock`). Không có Docker: đặt `TEST_DATABASE_URL` trỏ tới một DB trống.
- Test snippet WordPress chạy PHP bằng image `php:8.3-cli` (cũng cần Docker, gọi lệnh `docker` từ Node — Docker chạy trong WSL trên Windows thì test này không chạy được).
- **E2E** tự chạy `next start` (cổng 3100) và worker (health 3199), **seed lại DB demo (xóa dữ liệu cũ)** trước khi chạy; `E2E_SEED=0` để bỏ qua. Cần Postgres + Redis (`pnpm infra:up`). Nếu stack Docker đang chạy, dừng `web` và `worker` trước (`docker compose stop web worker`), vì worker cũ cũng lấy job từ cùng Redis.
- Lần đầu chạy e2e: `pnpm --filter @michio/web exec playwright install chromium`.

## Kết nối form website
Xem `docs/wordpress-snippet.md`. Tạo API key ở **Cài đặt & Tích hợp → API key website**. Thử nhanh:
```bash
curl -X POST localhost:3000/api/v1/public/leads -H 'X-Api-Key: mk_test_michio_website_dev' -H 'Content-Type: application/json' \
  -d '{"fullName":"Khách thử","phone":"0912 345 678","businessModel":"Shop online","expectedOrderBand":"10–30 triệu"}'
```

## Job nền (worker)
| Job | Lịch | Ghi chú |
|---|---|---|
| `sla-check` | đúng `acceptDeadline` của từng lượt giao | thu hồi + chia lại |
| `sla-sweeper` | mỗi phút | lưới an toàn; cảnh báo quá hạn liên hệ |
| `out-of-hours-release` | 08:00 T2–T7 (giờ VN) | chỉ có việc khi `assignment.outOfHoursMode = HOLD` |
| `import` | theo yêu cầu | import Excel khách |
| `task-reminder` | mỗi phút | nhắc việc trước `remindBeforeMinutes`, cảnh báo "còn 3 phút để nhận lead", tổng kết sáng (trong 2 giờ sau `notify.dailyDigestTime`, chỉ ngày làm việc) |
| `zalo-bot-inbound` | mỗi tin nhắn tới bot | chạy lệnh (LEAD, NHAN, TRA…), trả lời qua bot |
| `zalo-bot-notify` | mỗi thông báo mới | gửi Zalo; ngoài giờ làm việc thì hoãn tới giờ mở cửa (trừ loại khẩn) |

## Zalo Bot (M2)
1. Tạo bot tại https://bot.zaloplatforms.com, lấy token. Đặt trong `.env`: `ZALO_BOT_TOKEN`, `ZALO_BOT_WEBHOOK_SECRET` (8–256 ký tự), `APP_URL` (HTTPS công khai), `MOCK_INTEGRATIONS=false`. Khởi động lại web + worker.
2. Owner: **Cài đặt & Tích hợp → Zalo Bot → Đăng ký webhook** (gọi `setWebhook` tới `APP_URL/api/v1/webhooks/zalo-bot`; Zalo gửi header `X-Bot-Api-Secret-Token`).
3. Mỗi nhân viên: **Hồ sơ → Kết nối Zalo Bot → Lấy mã kết nối**, nhắn mã 6 số cho bot (hạn 10 phút).
- Chưa có HTTPS (máy dev): `ZALO_BOT_POLLING=true` để worker dùng `getUpdates` — chỉ chạy khi **chưa** đăng ký webhook (hai cách loại trừ nhau).
- Chế độ demo `MOCK_INTEGRATIONS=true`: không gọi Zalo; trang Hồ sơ có khung **Zalo Bot (mô phỏng)** đi qua đúng luồng webhook → lệnh → trả lời; thông báo của worker cũng hiện ở đó.
- Tin tới bot được lưu ở bảng `WebhookEvent` (`source = zalo-bot`); tin trùng `message_id` chỉ chạy một lần.
- **Bot không trả lời**: kiểm tra worker chạy, `WebhookEvent.status/error` của tin gần nhất (màn Cài đặt → Zalo Bot hiện tin gần nhất), token còn hiệu lực (lỗi 401 trong log worker).

## Sự cố thường gặp
- **Bị khóa đăng nhập 15 phút** (dev): `docker compose exec redis redis-cli --scan --pattern 'login-fail:*' | xargs docker compose exec -T redis redis-cli del`.
- **Lead không được thu hồi khi quá hạn**: kiểm tra worker đang chạy (`/api/v1/health` → `worker.ok`) và chỉ có **một phiên bản** worker cũ/mới cùng trỏ vào Redis.
- **`/health` báo worker không có heartbeat**: worker ghi `worker:heartbeat` mỗi 60 giây; kiểm tra `docker compose logs worker`.

_Backup, khôi phục, HTTPS (Caddy) sẽ bổ sung ở M6._
