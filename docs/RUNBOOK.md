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
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration          # Postgres thật qua testcontainers (cần Docker truy cập được từ Node)
# Docker trong WSL / không có testcontainers: dùng một database riêng tên chứa "test"
#   docker compose exec postgres psql -U michio -d michio_sales -c "CREATE DATABASE michio_test"
#   TEST_DATABASE_URL=postgresql://michio:michio@localhost:5432/michio_test pnpm test:integration
pnpm --filter @michio/web build && pnpm db:seed && pnpm test:e2e   # cần Postgres/Redis đang chạy
```
Lần đầu chạy e2e: `pnpm --filter @michio/web exec playwright install chromium`.

## Sự cố thường gặp
- **Bị khóa đăng nhập 15 phút** (dev): `docker compose exec redis redis-cli --scan --pattern 'login-fail:*' | xargs docker compose exec -T redis redis-cli del`.
- **`/health` báo worker không có heartbeat**: worker ghi `worker:heartbeat` mỗi 60 giây; kiểm tra `docker compose logs worker`.

_Backup, khôi phục, HTTPS (Caddy) sẽ bổ sung ở M6._

## Lead & chia lead (M1)
- **Lead không được chia / nằm "Chờ giao"**: xem màn Chia lead → "Thử luật" để biết vì sao từng sales bị loại (bận, nghỉ phép, đủ lead mở, đã trả lead). Kiểm tra có luật đang bật.
- **Hạn nhận không bị thu hồi**: worker phải chạy (`/api/v1/health` → `worker.ok`). Job `sla-sweeper` chạy mỗi phút sẽ thu hồi mọi assignment quá hạn còn sót.
- **Website không gửi được lead**: kiểm tra API key còn hiệu lực (Cài đặt → API key) và thử `curl` theo `docs/wordpress-snippet.md`. 429 = quá 60 yêu cầu/phút/key.
- **Lịch nghỉ lễ năm mới**: Tết, ngày nghỉ bù, ngày liền kề Quốc khánh phải được Owner thêm và xác nhận trong Cài đặt → Ngày lễ (trang chủ Owner nhắc tới khi xác nhận).
- Sau `pnpm db:seed`, các lead "Chờ nhận" trong dữ liệu mẫu sẽ bị sweeper thu hồi và chia lại sau 10 phút nếu worker đang chạy — đó là hành vi đúng.
