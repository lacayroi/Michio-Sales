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
- Test snippet WordPress chạy PHP bằng image `php:8.3-cli` (cũng cần Docker).
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

## Sự cố thường gặp
- **Bị khóa đăng nhập 15 phút** (dev): `docker compose exec redis redis-cli --scan --pattern 'login-fail:*' | xargs docker compose exec -T redis redis-cli del`.
- **Lead không được thu hồi khi quá hạn**: kiểm tra worker đang chạy (`/api/v1/health` → `worker.ok`) và chỉ có **một phiên bản** worker cũ/mới cùng trỏ vào Redis.
- **`/health` báo worker không có heartbeat**: worker ghi `worker:heartbeat` mỗi 60 giây; kiểm tra `docker compose logs worker`.

_Backup, khôi phục, HTTPS (Caddy) sẽ bổ sung ở M6._
