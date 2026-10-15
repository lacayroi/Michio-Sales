# Michio Sales Hub
- Spec: SPEC.md (đọc trước khi làm bất cứ việc gì)
- Monorepo pnpm. Lệnh: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm db:migrate`, `pnpm db:seed`
- Không commit secrets. Biến môi trường mẫu ở `.env.example`.
- Mọi thay đổi schema phải qua Prisma migration.
- Mọi gửi tin ra ngoài (Facebook, Zalo) phải đi qua `packages/channels` (MessageGateway), không gọi API trực tiếp từ nơi khác.
- Mọi thay đổi lead/khách/đơn/assignment phải ghi AuditLog.
- Màu thương hiệu: đỏ #E3262E (accent), xanh #00A651 (primary) — xem mục 10.1.
- Test: Vitest (unit), Playwright (e2e). Không merge khi test đỏ.
