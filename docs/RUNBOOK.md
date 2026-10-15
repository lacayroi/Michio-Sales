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
pnpm --filter @michio/web build && pnpm db:seed && pnpm test:e2e   # cần Postgres/Redis đang chạy
```
Lần đầu chạy e2e: `pnpm --filter @michio/web exec playwright install chromium`.

## Sự cố thường gặp
- **Bị khóa đăng nhập 15 phút** (dev): `docker compose exec redis redis-cli --scan --pattern 'login-fail:*' | xargs docker compose exec -T redis redis-cli del`.
- **`/health` báo worker không có heartbeat**: worker ghi `worker:heartbeat` mỗi 60 giây; kiểm tra `docker compose logs worker`.

_Backup, khôi phục, HTTPS (Caddy) sẽ bổ sung ở M6._
