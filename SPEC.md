# MICHIO SALES HUB — Tài liệu đặc tả kỹ thuật (SPEC)

> Phiên bản: **1.1** · Ngày: 15/10/2026 · Khách hàng: **Michio Việt Nam** (https://michiovietnam.com)
> Mục đích: tài liệu đầu vào để **Claude Code** xây dựng ứng dụng quản lý, chia việc và chăm sóc khách **sỉ** cho đội sales của Michio.
> Cách dùng: đặt file này ở gốc repo với tên `SPEC.md`, tạo `CLAUDE.md` theo mục 0.2.

**Thay đổi so với v1.0:** cập nhật theo mô hình thực tế của Michio — bán sỉ hàng Nhật nội địa, 3 sales, lead từ Zalo + Facebook + form web, chia xoay vòng, **chưa có Zalo OA**, nghỉ Chủ nhật, nhận diện thương hiệu theo logo. Bổ sung: tích hợp Facebook Messenger, form sỉ WordPress, đồng bộ sản phẩm WooCommerce, báo giá sỉ PDF, ghi nhận đơn sỉ, nhắc khách tái đặt hàng. Lược bớt phần phân cấp nhiều đội.

---

## 0. Hướng dẫn dành cho Claude Code

### 0.1 Nguyên tắc làm việc
1. Đọc toàn bộ SPEC trước khi viết code. Mục 7 (Data model) và mục 8 (API) là **nguồn sự thật**; nếu mâu thuẫn với phần mô tả, ưu tiên mục 7–8 và ghi lại lý do trong `docs/DECISIONS.md`.
2. Làm **đúng thứ tự milestone ở mục 13**. Không bắt đầu milestone sau khi milestone trước chưa đạt "Definition of Done".
3. Mỗi milestone: migration → service + unit test → API + integration test → UI → cập nhật `docs/CHANGELOG.md`.
4. Chỗ ghi `[CẦN XÁC NHẬN]` là giả định: làm theo giá trị mặc định ghi kèm và đưa vào bảng `Setting` để đổi được không cần sửa code.
5. Mọi thông số của nền tảng bên ngoài (Zalo, Meta/Facebook, WooCommerce: endpoint, thời hạn token, khung thời gian được nhắn, hạn mức, định dạng chữ ký webhook, quyền cần xin) **phải đối chiếu tài liệu chính thức trước khi code** và để trong hằng số/cấu hình tập trung, không hard-code rải rác:
   - Zalo Bot: https://bot.zaloplatforms.com
   - Zalo OA (giai đoạn sau): https://developers.zalo.me
   - Meta Messenger Platform / Webhooks / Lead Ads: https://developers.facebook.com/docs/messenger-platform
   - WooCommerce REST API: https://woocommerce.github.io/woocommerce-rest-api-docs/
6. Giao diện, thông báo, dữ liệu mẫu: **tiếng Việt**. Code, tên biến, commit message: tiếng Anh.
7. Ưu tiên **đơn giản**: đội hiện có 3 sales. Không xây tính năng cho quy mô lớn khi chưa cần; nhưng giữ `orgId`/`teamId` trong dữ liệu để mở rộng.

### 0.2 Nội dung `CLAUDE.md`
```md
# Michio Sales Hub
- Spec: SPEC.md (đọc trước khi làm bất cứ việc gì)
- Monorepo pnpm. Lệnh: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm db:migrate`, `pnpm db:seed`
- Không commit secrets. Biến môi trường mẫu ở `.env.example`.
- Mọi thay đổi schema phải qua Prisma migration.
- Mọi gửi tin ra ngoài (Facebook, Zalo) phải đi qua `packages/channels` (MessageGateway), không gọi API trực tiếp từ nơi khác.
- Mọi thay đổi lead/khách/đơn/assignment phải ghi AuditLog.
- Màu thương hiệu: đỏ #E3262E (accent), xanh #00A651 (primary) — xem mục 10.1.
- Test: Vitest (unit), Playwright (e2e). Không merge khi test đỏ.
```

---

## 1. Bối cảnh & mục tiêu

### 1.1 Về Michio Việt Nam
- Nhập khẩu và phân phối **hàng Nhật nội địa chính hãng**; website giới thiệu hơn 10.000 sản phẩm, giao hàng toàn quốc.
- Nhóm hàng: Matcha & Trà Nhật, Thực phẩm (bánh kẹo, gia vị, đồ cho bé), Đồ uống, Gia dụng (dụng cụ bếp, chống côn trùng, chất tẩy rửa), Chăm sóc răng miệng, Chăm sóc cá nhân, Mẹ & Bé, Sức khỏe, Sắc đẹp.
- **Khách hàng chủ yếu là khách sỉ**: cửa hàng hàng Nhật, shop online, minimart/siêu thị mini, đại lý bán lẻ, quán cafe/đồ uống, doanh nghiệp/đối tác phân phối.
- Quy trình sỉ hiện công bố trên web: Đăng ký nhu cầu → Tư vấn nhóm hàng → Báo giá/chính sách → Xác nhận đơn → Giao hàng. Giá sỉ báo theo **mã hàng và số lượng**, không suy ra từ giá lẻ.
- Website: WordPress + WooCommerce, có trang `/si-hang-nhat/` với form "Nhận bảng giá sỉ" và trang `/dang-ky-dai-ly/`.
- Kênh liên hệ: Zalo công ty **0337850791** (Zalo cá nhân), Facebook Page `Michio.Hangnhatnoidia`, hotline 0246.68.56.986, Instagram, YouTube.
- Địa chỉ: Số 3 ngõ 204/9 Kim Giang, phường Định Công, Hà Nội.

### 1.2 Hiện trạng bán hàng (theo thông tin Michio cung cấp)
| Hạng mục | Hiện trạng |
|---|---|
| Đội sales | **3 nhân viên** |
| Nguồn lead chính | **Zalo** và **Facebook** (+ form sỉ trên website) |
| Cách chia lead | **Xoay vòng** |
| Zalo OA | **Chưa có** |
| Lịch làm việc | Thứ 2 – Thứ 7, **nghỉ Chủ nhật** |

### 1.3 Vấn đề cần giải quyết
1. Lead từ Zalo công ty, Facebook, form web nằm rải rác; chia xoay vòng làm tay → dễ lệch, dễ sót, không biết ai đang giữ khách nào.
2. Không đo được tốc độ phản hồi và tỷ lệ chốt của từng sales.
3. Khách sỉ mua lặp lại nhưng không có cơ chế nhắc **tái đặt hàng** → mất đơn.
4. Báo giá sỉ làm thủ công, không lưu lịch sử.
5. Khách nằm trong Zalo/điện thoại cá nhân của sales → mất khách khi nhân viên nghỉ.

### 1.4 Mục tiêu & chỉ số
| # | Mục tiêu | KPI |
|---|---|---|
| G1 | Lead mới được giao tự động, xoay vòng đều | Lead → được giao < 10 giây; lệch số lead giữa 3 sales trong tháng ≤ 5% |
| G2 | Phản hồi nhanh | Thời gian phản hồi đầu tiên (FRT) trung vị < 15 phút trong giờ làm việc |
| G3 | Không sót lead | 0 lead quá hạn mà không bị thu hồi hoặc cảnh báo |
| G4 | Giữ chân khách sỉ | 100% khách đã mua có lịch nhắc tái đặt; tỷ lệ khách quay lại theo quý đo được |
| G5 | Dữ liệu thuộc công ty | Chuyển toàn bộ khách của 1 sales sang người khác trong < 1 phút |
| G6 | Chủ doanh nghiệp nắm tình hình | Dashboard cập nhật ≤ 1 phút; báo cáo tổng kết qua Zalo mỗi sáng |

### 1.5 Người dùng
| Vai trò | Ai | Ghi chú |
|---|---|---|
| **OWNER** | Chủ doanh nghiệp / Giám đốc | Toàn quyền |
| **MANAGER** | Trưởng phòng kinh doanh (nếu có) | Như Owner trừ cấu hình tích hợp & xóa dữ liệu |
| **SALES** | 3 nhân viên kinh doanh | Chăm lead & khách của mình |
| **SUPPORT** | Kế toán / kho / CSKH (tùy chọn) | Xem đơn, cập nhật trạng thái giao hàng, thanh toán |
| **VIEWER** | Ban giám đốc chỉ xem | Chỉ đọc báo cáo |

---

## 2. Phạm vi

### 2.1 Trong phạm vi v1
1. Người dùng, phân quyền, trạng thái làm việc, lịch nghỉ.
2. **Tiếp nhận lead** từ: form sỉ & form đăng ký đại lý trên website (WordPress), **Facebook Messenger** (Page), **Facebook Lead Ads** (nếu chạy quảng cáo form), **Zalo công ty** (nhập nhanh hoặc qua cổng kết nối tùy chọn — xem 5.3), hotline/nhập tay, import Excel.
3. Chống trùng theo SĐT / tài khoản mạng xã hội.
4. **Chia lead xoay vòng** (mặc định) + thời hạn nhận + tự thu hồi; hỗ trợ thêm chia theo tải và giao tay.
5. Hộp thư hội thoại Facebook Messenger (và Zalo công ty nếu bật cổng kết nối).
6. Hồ sơ **khách sỉ**: mô hình kinh doanh, mức nhập dự kiến, nhóm hàng quan tâm, tỉnh/thành, vòng đời khách.
7. Pipeline bán sỉ, **báo giá sỉ (xuất PDF có logo)**, **ghi nhận đơn sỉ** (không quản lý kho).
8. **Nhắc tái đặt hàng** theo chu kỳ mua của từng khách; cảnh báo khách "ngủ đông".
9. Task & nhắc việc.
10. **Zalo Bot nội bộ**: báo lead mới, nhắc việc, thao tác nhanh cho sales ngay trên Zalo.
11. Đồng bộ danh mục sản phẩm từ **WooCommerce** (mã, tên, danh mục, giá lẻ, ảnh, trạng thái còn hàng).
12. Chuyển giao khách khi sales nghỉ.
13. Dashboard, báo cáo, chỉ tiêu tháng, xuất Excel.
14. Audit log. Web app responsive + PWA.

### 2.2 Ngoài phạm vi v1
- Quản lý kho, xuất hóa đơn điện tử, công nợ chi tiết (v1 chỉ lưu trạng thái thanh toán của đơn).
- Zalo OA, ZNS (bổ sung khi Michio đăng ký OA — đã chừa sẵn kiến trúc, mục 5.4).
- Gửi tin hàng loạt / marketing tự động.
- Tổng đài, ghi âm cuộc gọi.
- App native (dùng PWA).
- AI (giai đoạn 2).

### 2.3 Giả định `[CẦN XÁC NHẬN]`
| Mã | Giả định | Mặc định |
|---|---|---|
| A1 | Giờ làm việc T2–T7 | 08:00–17:30, nghỉ trưa 12:00–13:30 |
| A2 | Có cần 1 người làm "quản lý" ngoài Owner không | Không; Owner kiêm quản lý |
| A3 | Khu vực bán | Toàn quốc; chưa chia vùng cho sales |
| A4 | Chia lead | Xoay vòng đều giữa sales đang làm việc |
| A5 | Chu kỳ tái đặt hàng mặc định | 30 ngày, tự điều chỉnh theo lịch sử mua của từng khách |
| A6 | Bảng giá sỉ | Có các cấp giá (vd: Sỉ 1, Sỉ 2, Đại lý) theo mã hàng; nhập từ Excel |
| A7 | Ai trực Zalo công ty 0337850791 | 1 người trực (Owner hoặc 1 sales), chuyển lead vào hệ thống |
| A8 | Facebook Page | Page `Michio.Hangnhatnoidia` do Michio quản trị |

---

## 3. Vai trò & phân quyền

Phạm vi dữ liệu: `ALL` = toàn công ty, `OWN` = bản ghi mình phụ trách.

| Quyền | OWNER | MANAGER | SALES | SUPPORT | VIEWER |
|---|---|---|---|---|---|
| Xem lead / khách | ALL | ALL | OWN | ALL (chỉ đọc) | ALL (chỉ đọc) |
| Tạo lead | ✓ | ✓ | ✓ (tự giao cho mình) | ✗ | ✗ |
| Sửa lead / khách | ALL | ALL | OWN | ✗ | ✗ |
| Giao / chuyển lead | ✓ | ✓ | chỉ "Trả lại" | ✗ | ✗ |
| Xem & nhắn hội thoại | ALL | ALL | OWN | ✗ | ✗ |
| Tạo báo giá / đơn | ✓ | ✓ | OWN | ✗ | ✗ |
| Cập nhật giao hàng / thanh toán đơn | ✓ | ✓ | OWN (chỉ xem) | ✓ | ✗ |
| Sửa bảng giá sỉ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Cấu hình chia lead, SLA | ✓ | ✓ | ✗ | ✗ | ✗ |
| Quản lý người dùng | ✓ | ✗ | ✗ | ✗ | ✗ |
| Chuyển giao hàng loạt | ✓ | ✓ | ✗ | ✗ | ✗ |
| Báo cáo | ALL | ALL | bản thân | đơn hàng | ALL |
| Xuất Excel | ✓ | ✓ | ✗ | ✓ (đơn) | ✓ |
| Cấu hình tích hợp | ✓ | ✗ | ✗ | ✗ | ✗ |
| Audit log | ✓ | ✓ | ✗ | ✗ | ✗ |
| Xóa (mềm) | ✓ | ✗ | ✗ | ✗ | ✗ |

Triển khai:
- Kiểm tra quyền ở **tầng service** qua hàm duy nhất `authorize(user, action, resource)` (`packages/auth`).
- Query danh sách đi qua `scopeFilter(user, entity)`.
- Có unit test dạng bảng cho toàn bộ ma trận.

---

## 4. Kiến trúc & công nghệ

### 4.1 Tech stack
| Lớp | Công nghệ |
|---|---|
| Ngôn ngữ | TypeScript (strict) |
| Monorepo | pnpm workspaces + Turborepo |
| Web | Next.js 15 (App Router), Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form + Zod |
| API | Next.js Route Handlers `/api/v1/*`, validate bằng Zod |
| Realtime | Server-Sent Events qua Redis pub/sub |
| DB | PostgreSQL 16 + Prisma |
| Job | Redis 7 + BullMQ (`apps/worker`) |
| Auth | Session cookie httpOnly (Auth.js Credentials hoặc Lucia), argon2 |
| File | S3-compatible (SeaweedFS khi dev; production dùng dịch vụ S3-compatible bất kỳ) — lưu PDF báo giá, ảnh |
| PDF | `@react-pdf/renderer` (font hỗ trợ tiếng Việt: Be Vietnam Pro / Inter) |
| Excel | `exceljs` |
| Test | Vitest, Playwright, testcontainers |
| Log | pino; Sentry (tùy chọn) |
| Triển khai | Docker Compose + Caddy (HTTPS) |

### 4.2 Sơ đồ
```
 Khách sỉ
   │  Facebook Messenger / Lead Ads ──webhook──┐
   │  Form sỉ & đại lý (WordPress) ───POST─────┤
   │  Zalo công ty 0337850791 ──(5.3)──────────┤
   │  Hotline / nhập tay / Excel ──────────────┤
   ▼                                           ▼
┌─────────────────────────────────────────────────────────┐
│ apps/web (Next.js): UI PWA · /api/v1 · /webhooks/*      │
└──────────┬───────────────────────────────┬──────────────┘
           │ Prisma                        │ enqueue
           ▼                               ▼
     PostgreSQL ◄──────────────── apps/worker (BullMQ)
           ▲                       - assignment / SLA
     Redis ◄──────────────────────►- channel inbound/outbound
                                   - reminders / reorder / digest
                                   - woo product sync / PDF
                                        │
        ┌───────────────────────┬───────┴──────────┬────────────────────────┐
        ▼                       ▼                  ▼                        ▼
  Meta Graph API          Zalo Bot API       WooCommerce REST      apps/zalo-company-gateway
  (Messenger, Lead Ads)   (thông báo sales)  (đồng bộ sản phẩm)    (tùy chọn, feature flag)
```

### 4.3 Cấu trúc repo
```
michio-sales-hub/
├─ apps/
│  ├─ web/                       # Next.js: UI + API + webhooks
│  ├─ worker/                    # BullMQ processors + cron
│  └─ zalo-company-gateway/      # tùy chọn (5.3), tắt mặc định
├─ packages/
│  ├─ db/                        # Prisma schema, migrations, seed
│  ├─ core/                      # domain: lead, assignment, customer, quote, order, task, report
│  ├─ auth/                      # session, authorize(), scopeFilter()
│  ├─ channels/                  # MessageGateway + facebook/, zalo-bot/, zalo-company/, zalo-oa/ (stub)
│  ├─ integrations/              # woocommerce/, wordpress-form/
│  ├─ pdf/                       # mẫu báo giá
│  └─ shared/                    # zod schemas, constants, utils (normalizeVnPhone, business time…)
├─ docs/ (DECISIONS.md, CHANGELOG.md, RUNBOOK.md, HUONG-DAN.md, wordpress-snippet.md)
├─ docker-compose.yml · .env.example · SPEC.md · CLAUDE.md
```
Logic nghiệp vụ chỉ nằm trong `packages/core`. Route handler: xác thực → validate → gọi service → trả kết quả.

---

## 5. Tích hợp kênh

Mọi kênh nhắn tin đi qua interface chung để thêm/bớt kênh không ảnh hưởng nghiệp vụ:
```ts
// packages/channels/src/gateway.ts
export type ChannelType = 'FACEBOOK_PAGE' | 'ZALO_COMPANY' | 'ZALO_BOT' | 'ZALO_OA';

export interface OutboundMessage {
  channelAccountId: string;
  externalUserId: string;          // PSID (Facebook) / uid (Zalo)
  kind: 'text' | 'image' | 'file';
  text?: string;
  attachmentUrl?: string;
  idempotencyKey: string;
}
export interface MessageGateway {
  canSend(conversationId: string): Promise<{ ok: boolean; reason?: string }>; // kiểm tra khung thời gian được nhắn
  send(msg: OutboundMessage): Promise<{ externalMessageId: string }>;
}
```

### 5.1 Form sỉ & đăng ký đại lý trên website (WordPress) — **v1, ưu tiên cao**
Form hiện có tại `michiovietnam.com/si-hang-nhat/` thu thập: Họ và tên*, Số điện thoại*, Tên shop/doanh nghiệp, Email, Tỉnh/thành, Mô hình kinh doanh, Mức nhập dự kiến, Nhóm hàng quan tâm (nhiều lựa chọn), Ghi chú. Trang `/dang-ky-dai-ly/` có form tương tự `[CẦN XÁC NHẬN trường của form đại lý]`.

**Cách kết nối**: website gửi `POST /api/v1/public/leads` (Phụ lục B) mỗi khi form được gửi.
- Claude Code viết sẵn đoạn code PHP mẫu trong `docs/wordpress-snippet.md` để gắn vào hook của plugin form đang dùng `[CẦN XÁC NHẬN plugin: Contact Form 7 / WPForms / Fluent Forms / form tự viết của theme]` (vd hook `wpcf7_mail_sent`, `wpforms_process_complete`), gửi kèm `X-Api-Key`, timeout 5 giây, không chặn trải nghiệm người dùng nếu API lỗi (form vẫn gửi email như cũ).
- Ánh xạ giá trị (lưu dạng mã):

| Trường form | Trường hệ thống | Giá trị |
|---|---|---|
| Mô hình kinh doanh | `businessModel` | `JAPAN_STORE` (Cửa hàng hàng Nhật), `ONLINE_SHOP` (Shop online), `MINIMART` (Minimart / siêu thị mini), `RETAIL_AGENT` (Đại lý bán lẻ), `CAFE` (Quán cafe / đồ uống), `DISTRIBUTOR` (Doanh nghiệp / đối tác phân phối), `OTHER` |
| Mức nhập dự kiến | `expectedOrderBand` | `LT_5M` (<5tr), `5_10M`, `10_30M`, `30_50M`, `GT_50M` (>50tr), `UNKNOWN` |
| Nhóm hàng quan tâm | `interestCategories[]` | `MATCHA_TEA`, `FOOD`, `DRINK`, `HOUSEHOLD`, `OTHER` (+ các danh mục đồng bộ từ WooCommerce) |
| Nguồn | `source` | `WEBSITE_WHOLESALE_FORM` / `WEBSITE_AGENT_FORM` |

- **Mức ưu tiên tự động** theo mức nhập: `GT_50M`, `30_50M` → HOT; `10_30M`, `5_10M` → WARM; còn lại → COLD (cấu hình được). Lead HOT hiển thị nổi bật và có thời hạn nhận ngắn hơn (mặc định 5 phút thay vì 10).

### 5.2 Facebook Page — Messenger & Lead Ads — **v1**
**Thiết lập**
- Tạo Meta App (loại Business), thêm sản phẩm Messenger + Webhooks; kết nối Page `Michio.Hangnhatnoidia`; lấy Page Access Token dài hạn qua luồng đăng nhập Facebook của Owner trong màn **Tích hợp**.
- Quyền cần xin (đối chiếu tài liệu Meta hiện hành): nhắn tin Page, đọc tin Page, quản lý metadata Page, đọc lead từ Lead Ads. Để nhận tin từ khách thật cần qua **Meta App Review** và xác minh doanh nghiệp — đưa việc này vào checklist go-live (mục 13, M2) vì có thể mất vài ngày đến vài tuần.
- Lưu token mã hóa trong `ChannelAccount.credentials`.

**Webhook** `GET/POST /webhooks/facebook`
- `GET`: trả `hub.challenge` khi `hub.verify_token` khớp `FB_VERIFY_TOKEN`.
- `POST`: xác minh chữ ký `X-Hub-Signature-256` (HMAC-SHA256 bằng App Secret); trả 200 ngay; đẩy vào queue `channel-inbound`; lưu `WebhookEvent` để idempotent & replay.
- Sự kiện: tin nhắn Messenger (text, ảnh, file, sticker), postback, **leadgen** (Lead Ads → gọi Graph API lấy dữ liệu form theo `leadgen_id`).

**Xử lý tin nhắn vào**: như 6.2 — tìm/tạo Contact theo PSID (lấy tên, ảnh đại diện qua Graph API), tìm/tạo Conversation, lưu Message, tạo Lead nếu chưa có lead đang mở, chia lead.

**Gửi tin ra**: qua queue `channel-outbound`, retry backoff tối đa 5 lần, idempotencyKey.
- Tuân thủ chính sách khung thời gian nhắn tin của Messenger (tin thường trong khung giờ sau tin cuối của khách; ngoài khung chỉ được dùng thẻ tin được phép như thẻ "nhân viên hỗ trợ" nếu đủ điều kiện). Đặt trong `Setting` (`facebook.standardWindowHours`, `facebook.humanAgentWindowDays`, `facebook.useHumanAgentTag`) — **đối chiếu tài liệu Meta**.
- `canSend()` trả lý do khi hết khung → UI khóa ô soạn tin, gợi ý "Gọi điện" hoặc "Nhắn Zalo" (nút mở `https://zalo.me/{phone}`), tự tạo task nếu sales chọn.

**Bình luận Page** (giai đoạn sau): bình luận có SĐT trên bài quảng cáo → tạo lead. Ghi trong backlog.

### 5.3 Zalo công ty 0337850791 (Zalo cá nhân) — **v1 có 2 chế độ**
Vì Michio **chưa có Zalo OA**, khách nhắn vào số Zalo công ty (là tài khoản Zalo cá nhân). Hệ thống hỗ trợ 2 chế độ, Owner chọn trong Cài đặt:

**Chế độ A — Ghi nhận nhanh (mặc định, an toàn, không rủi ro tài khoản)**
- Người trực Zalo công ty tạo lead trong < 15 giây bằng một trong các cách:
  1. Nút **"+ Lead nhanh"** trên web/PWA (chỉ cần SĐT + tên + ghi chú; tự chọn nguồn `ZALO_COMPANY`).
  2. Nhắn lệnh cho **Zalo Bot** nội bộ: `LEAD 0912345678 Chị Hoa - shop mẹ bé Hải Phòng - quan tâm matcha, bánh kẹo` → bot tạo lead, chia xoay vòng, trả lại mã lead và tên sales nhận.
- Sales được giao sẽ **kết bạn/nhắn khách từ Zalo công việc của mình** hoặc tiếp tục trên Zalo công ty (theo quy định nội bộ), và ghi hoạt động (`GOI`, ghi chú) qua web hoặc bot.
- Ưu điểm: không phụ thuộc thư viện không chính thức. Nhược: hội thoại Zalo không lưu tự động trong hệ thống.

**Chế độ B — Cổng kết nối Zalo công ty (tùy chọn, bật bằng feature flag, có rủi ro)**
- Service riêng `apps/zalo-company-gateway` dùng thư viện **không chính thức** (`zca-js`) để đọc/gửi tin của số Zalo công ty, đưa hội thoại vào hộp thư chung và chia lead tự động như Facebook.
- **Cảnh báo bắt buộc hiển thị khi bật**: kết nối không chính thức có thể khiến tài khoản Zalo bị hạn chế hoặc khóa. Chỉ kết nối tài khoản Zalo của công ty, không kết nối Zalo cá nhân của nhân viên. Owner phải tick xác nhận đã hiểu rủi ro (lưu vào AuditLog).
- Cô lập: giao tiếp qua Redis queue (`zalo-company-inbound/outbound`); hệ thống chính chạy bình thường khi service tắt hoặc lỗi.
- Giới hạn bảo thủ (cấu hình được): ≥ 3 giây giữa 2 tin, ≤ 300 tin/ngày; **không** có gửi hàng loạt, kết bạn hàng loạt, quét nhóm; chỉ đồng bộ hội thoại 1-1.
- Đăng nhập bằng QR do Owner quét; mất phiên → trạng thái `DISCONNECTED`, báo Owner qua Zalo Bot, tự chuyển về Chế độ A.

### 5.4 Zalo OA — **chưa làm, chừa sẵn**
- Tạo `packages/channels/zalo-oa/` dạng stub cài đặt `MessageGateway` và route `/webhooks/zalo-oa` trả 501.
- Khi Michio đăng ký OA: OAuth, làm mới token định kỳ có khóa chống chạy đồng thời, webhook có xác minh chữ ký, chia lead như Facebook. Đây là hướng thay thế lâu dài an toàn cho Chế độ B.

### 5.5 Zalo Bot nội bộ — **v1** (kênh báo việc cho sales, không nhắn khách)
- Tạo bot tại https://bot.zaloplatforms.com (không cần Zalo OA); lưu `ZALO_BOT_TOKEN`; webhook `POST /webhooks/zalo-bot` xác minh header secret theo tài liệu.
- Bot tạo qua Bot Creator có thể **không thêm được vào nhóm** → chỉ nhắn **1-1** với từng nhân viên.
- **Liên kết tài khoản**: nhân viên vào Hồ sơ → "Kết nối Zalo Bot" → nhận mã 6 ký tự (hạn 10 phút) → nhắn mã cho bot → lưu `User.zaloBotChatId`.

**Thông báo**
| Sự kiện | Mẫu |
|---|---|
| Được giao lead | `🔔 Lead #1234 · Chị Hoa · 0912xxx678 · Shop mẹ & bé – Hải Phòng · Mức nhập 10–30tr · Quan tâm: Matcha, Bánh kẹo · Nguồn: Form sỉ. Nhận trước 14:35 → NHAN 1234 / TRA 1234` |
| Sắp hết hạn nhận | `⏰ Còn 3 phút để nhận lead #1234 → NHAN 1234` |
| Bị thu hồi | `↩️ Lead #1234 đã chuyển cho người khác do quá hạn nhận.` |
| Khách nhắn lại (FB/Zalo công ty) | `💬 Chị Hoa vừa nhắn: "…" – {link}` (tối đa 1 thông báo/khách/5 phút) |
| Task đến hạn | `📌 15:00 Gọi lại Shop ABC (#1201): gửi báo giá matcha` |
| Nhắc tái đặt hàng | `🔁 Shop ABC (Hải Phòng) đã 28 ngày chưa đặt lại, chu kỳ thường 30 ngày. Đơn gần nhất 12,5tr. → HEN 1201 …` |
| Tổng kết 08:00 (T2–T7) | Sales: lead mới, task hôm nay, khách cần nhắc tái đặt. Owner: lead hôm qua theo nguồn, lead chưa xử lý, doanh số tháng vs chỉ tiêu |
| Cảnh báo cho Owner | Lead quá hạn không ai nhận; kết nối Facebook/Zalo công ty lỗi |

**Lệnh** (không phân biệt hoa thường, chấp nhận không dấu):
| Lệnh | Tác dụng |
|---|---|
| `LEAD <SĐT> <tên/ghi chú>` | Tạo lead nguồn Zalo công ty, chia xoay vòng (chỉ người có quyền tạo lead) |
| `NHAN <mã>` | Nhận lead |
| `TRA <mã> [lý do]` | Trả lead → chia người kế tiếp |
| `GOI <mã> [ghi chú]` | Ghi nhận đã liên hệ (tính FRT) |
| `HEN <mã> <dd/mm hh:mm> <nội dung>` | Tạo task |
| `XONG <mã task>` | Hoàn thành task |
| `HOMNAY` | Việc & lead hôm nay |
| `TRANGTHAI <mã> <giai đoạn>` | Đổi giai đoạn (`TUVAN`, `BAOGIA`, `CHOT`, `THUA`) |
| `NGHI` / `LAMVIEC` | Tạm dừng / tiếp tục nhận lead |
| `HELP` | Danh sách lệnh |

Mọi lệnh kiểm tra quyền như trên web, ghi AuditLog với `via='ZALO_BOT'`.

### 5.6 WooCommerce — đồng bộ sản phẩm — **v1**
- Dùng WooCommerce REST API (Consumer Key/Secret chỉ quyền **Read**).
- Job `woo-product-sync`: đồng bộ toàn bộ lần đầu (phân trang), sau đó mỗi 6 giờ đồng bộ phần thay đổi (`modified_after`); hỗ trợ webhook WooCommerce `product.updated` nếu bật.
- Lấy: id, SKU, tên, danh mục, giá lẻ, ảnh đại diện, link sản phẩm, trạng thái tồn (`instock`/`outofstock`), thương hiệu (nếu có attribute/taxonomy).
- Sản phẩm không có SKU → dùng `woo-{id}` làm mã tạm, đánh dấu cần bổ sung.
- **Giá sỉ không lấy từ website**: quản lý trong hệ thống qua bảng giá sỉ (6.6).

---

## 6. Đặc tả chức năng

### 6.1 Người dùng & lịch làm việc
- Đăng nhập email hoặc SĐT + mật khẩu; quên mật khẩu qua email; khóa 15 phút sau 5 lần sai; phiên trên điện thoại giữ 30 ngày.
- Owner tạo/khóa tài khoản, gán vai trò, `maxOpenLeads` (mặc định 40).
- Trạng thái: `AVAILABLE`, `BUSY`, `OFF` (nghỉ phép có ngày bắt đầu/kết thúc), `INACTIVE` (đã nghỉ việc).
- Lịch công ty: T2–T7 theo A1, **Chủ nhật nghỉ**; bảng ngày lễ (seed sẵn lễ Việt Nam năm hiện tại, Owner chỉnh được).
- Ngày lễ seed phải gồm đủ 12 ngày nghỉ hưởng lương theo luật hiện hành, **kể cả Ngày Văn hóa Việt Nam 24/11** (áp dụng từ 2026). Với các dịp mà doanh nghiệp được chọn ngày nghỉ (Tết Âm lịch, ngày liền kề Quốc khánh 1/9 hoặc 3/9), seed theo phương án của khu vực nhà nước và hiển thị nhắc Owner xác nhận lại.
- Owner/Manager có nút **"Đặt lại mật khẩu"** cho nhân viên trong màn Người dùng (sinh mật khẩu tạm, bắt đổi ở lần đăng nhập sau). Luồng quên mật khẩu qua email làm ở M6.

### 6.2 Tiếp nhận lead & chống trùng
**Nguồn** (`LeadSource`): `WEBSITE_WHOLESALE_FORM`, `WEBSITE_AGENT_FORM`, `FACEBOOK_MESSENGER`, `FACEBOOK_LEAD_ADS`, `ZALO_COMPANY`, `HOTLINE`, `REFERRAL`, `IMPORT`, `MANUAL`, `ZALO_OA` (dự phòng), `OTHER`.

**Thông tin lead/khách sỉ**: họ tên người liên hệ, SĐT, email, tên shop/doanh nghiệp, mã số thuế (tùy chọn), mô hình kinh doanh, mức nhập dự kiến, nhóm hàng quan tâm, sản phẩm quan tâm (chọn từ danh mục), tỉnh/thành, địa chỉ giao hàng, link Facebook/Zalo, nguồn, chiến dịch/UTM, mức ưu tiên, tag, ghi chú.

**Chuẩn hóa SĐT**: `normalizeVnPhone()` → `+84xxxxxxxxx`; chấp nhận `0xxx`, `84xxx`, `+84xxx`, có khoảng trắng/chấm/gạch; kiểm tra đầu số di động và cố định VN; có unit test.

**Chống trùng**: khóa = SĐT chuẩn hóa **hoặc** `(kênh, externalUserId)` **hoặc** email.
- Khách đang có lead mở → không tạo lead mới; thêm Activity "Liên hệ lại qua {nguồn}"; báo sales đang phụ trách.
- Khách đã là **khách hàng** (đã có đơn) và có sales phụ trách → không chia xoay vòng; tạo lead "mua lại" giao thẳng cho sales phụ trách (`assignment.keepCustomerOwner = true`). Nếu sales đó `INACTIVE` → chia xoay vòng.
- Lead cũ đã đóng THUA → tạo lead mới, ưu tiên sales cũ nếu đang làm việc (cấu hình).
- Khi 1 khách nhắn Facebook trước rồi để lại SĐT (hoặc ngược lại), sales bấm **"Gộp"** để nối 2 hồ sơ; hệ thống gợi ý gộp khi tên + tỉnh trùng.

**Import Excel**: file mẫu (Phụ lục A) → xem trước lỗi từng dòng → xác nhận → job nền. Tùy chọn: chia xoay vòng / giao cho 1 người / chưa giao. Dùng để nhập danh sách khách sỉ hiện có.

**AC**: webhook gửi trùng 2 lần → 1 Message, 1 Lead; import 2.000 dòng < 60 giây; form web gửi lead → lead hiện trên hệ thống < 5 giây.

### 6.3 Chia lead (cốt lõi)
#### 6.3.1 Cấu hình mặc định cho Michio
- 1 luật mặc định: **ROUND_ROBIN** giữa 3 sales, áp dụng cho mọi nguồn.
- **Thời hạn nhận** (`acceptSlaMinutes`): 10 phút; lead HOT: 5 phút.
- **Thời hạn liên hệ đầu tiên** (`firstContactSlaMinutes`): 30 phút sau khi nhận.
- Tính theo **giờ làm việc** (Chủ nhật, ngày lễ, ngoài giờ không tính).
- Lead đến **ngoài giờ / Chủ nhật**: vẫn chia ngay (sales thấy khi bắt đầu ca), đồng hồ thời hạn bắt đầu từ đầu giờ làm việc kế tiếp. Tùy chọn `outOfHoursMode = HOLD` để giữ lại và chia lúc 08:00.
- Thu hồi tối đa 3 lần (`maxReassign`); quá 3 lần → vào hàng chờ, báo Owner.

#### 6.3.2 Luật & phương thức (mở rộng sau)
- Luật có thứ tự ưu tiên; điều kiện theo: nguồn, mô hình kinh doanh, mức nhập, nhóm hàng quan tâm, tỉnh/thành, tag, khung giờ. Luật cuối là mặc định.
- Phương thức: `ROUND_ROBIN` (mặc định), `WEIGHTED` (trọng số), `LEAST_LOADED` (ít lead đang mở nhất), `MANUAL` (vào hàng chờ, giao tay).
- Ví dụ mở rộng (không bật sẵn): lead `DISTRIBUTOR` hoặc `GT_50M` → giao cho sales giỏi nhất / Owner.

#### 6.3.3 Lọc ứng viên
Loại khỏi danh sách nếu: không `AVAILABLE`; đang nghỉ phép; đạt `maxOpenLeads`; đã từng trả hoặc bị thu hồi chính lead này. Nếu không còn ai → hàng chờ + báo Owner.

#### 6.3.4 Thuật toán
```
onLeadCreated(lead):
  if lead.contact là khách hàng có owner đang làm việc: assign(owner, method=CUSTOMER_OWNER); return
  rule = luật đầu tiên khớp
  if rule.method == MANUAL: queue(lead); notify owners; return
  pool = filterCandidates(rule, lead)
  if pool rỗng: theo rule.fallback (NEXT_RULE | QUEUE); return
  assignee = pick(rule, pool)       # transaction + pg_advisory_xact_lock(hash(rule.id))
                                    # ROUND_ROBIN: con trỏ rrCursor lưu DB, bỏ qua người không hợp lệ
  tạo LeadAssignment(PENDING, acceptDeadline = addBusinessMinutes(now, sla))
  enqueue notify(assignee); enqueue slaCheck(assignment, at=acceptDeadline)

onSlaCheck(a): if a.status == PENDING → EXPIRED; báo sales; chia lại (loại người cũ) hoặc queue
onAccept(a):   ACCEPTED; lead IN_PROGRESS; set firstContactDeadline
onReturn(a):   RETURNED; chia lại (loại người trả)
onFirstContact(lead): ghi firstContactAt (tin nhắn ra đầu tiên, hoặc lệnh GOI, hoặc Activity CALL)
```
- `autoAccept` (theo luật, mặc định **tắt**): bỏ bước Nhận.
- Quá thời hạn liên hệ: chỉ cảnh báo sales + Owner (mặc định); `reclaimOnContactSlaBreach` để bật thu hồi.
- `addBusinessMinutes()` phải có test: qua nghỉ trưa, qua đêm, **qua Chủ nhật**, qua ngày lễ.
- Job `sla-sweeper` mỗi phút quét assignment PENDING quá hạn (lưới an toàn khi worker khởi động lại).

#### 6.3.5 Giao tay
Owner/Manager giao hoặc chuyển từng lead hay nhiều lead cùng lúc. Mọi thay đổi tạo `LeadAssignment` mới + AuditLog; lịch sử xem được trên trang lead.

**AC**
- 90 lead tạo song song → mỗi sales nhận đúng 30 (± 1).
- Sales đang `OFF` không nhận lead; lượt xoay vòng chuyển sang người kế tiếp.
- Lead không được nhận bị thu hồi ≤ 60 giây sau hạn.
- Lead vào lúc 20:00 thứ 7 có hạn nhận là 08:10 thứ 2 (nếu không phải ngày lễ).

### 6.4 Hộp thư hội thoại
- 3 cột: danh sách (lọc: của tôi / chưa đọc / chưa trả lời / theo kênh) — khung chat — thẻ khách (sửa nhanh giai đoạn, tạo báo giá, task, ghi chú).
- Kênh: Facebook Messenger; Zalo công ty (nếu Chế độ B).
- Hiển thị text, ảnh, file, sticker; gửi text, ảnh, file; gửi **link sản phẩm / ảnh sản phẩm** chọn từ danh mục; gửi **PDF báo giá** vừa tạo.
- **Mẫu trả lời nhanh** (gõ `/`): có biến `{ten_khach}`, `{ten_sales}`, `{sdt_sales}`; seed sẵn mẫu: chào khách sỉ, xin thông tin shop, gửi chính sách sỉ, hẹn gọi lại.
- Ghi chú nội bộ (khách không thấy), @nhắc đồng nghiệp.
- Hiển thị trạng thái khung thời gian nhắn tin (5.2), khóa gửi khi hết khung kèm lý do.
- Realtime qua SSE; badge chưa đọc.

### 6.5 Vòng đời khách sỉ & pipeline
**Pipeline cơ hội (Deal)** — mặc định, cấu hình được:
`MOI` Mới → `DA_LIEN_HE` Đã liên hệ → `TU_VAN` Tư vấn nhóm hàng → `BAO_GIA` Đã gửi báo giá/chính sách → `CHOT` Chốt đơn (thắng) / `THUA` Không thành công.
- Xác suất mặc định: 10 / 20 / 40 / 60 / 100 / 0 (%).
- Sang `THUA` bắt buộc chọn lý do: Giá cao hơn nguồn khác · Mức nhập tối thiểu không phù hợp · Không có mặt hàng cần · Chỉ hỏi giá / chưa có nhu cầu · Không liên lạc được · Chọn nhà cung cấp khác · Khác.
- Sang `CHOT` → tạo **Đơn sỉ** (6.7).
- Kanban kéo-thả + dạng bảng.

**Vòng đời khách** (`Customer.lifecycle`, hệ thống tự cập nhật):
| Trạng thái | Điều kiện |
|---|---|
| `PROSPECT` | Chưa có đơn |
| `NEW_CUSTOMER` | Có 1 đơn |
| `REPEAT` | ≥ 2 đơn |
| `AT_RISK` | Quá 1,5 × chu kỳ tái đặt mà chưa đặt lại |
| `DORMANT` | Quá 90 ngày không đặt (cấu hình) |

**Phân hạng khách** (`tier`, Owner chỉnh tay hoặc tự động theo doanh số 90 ngày): `SI_1`, `SI_2`, `DAI_LY` `[CẦN XÁC NHẬN tên và ngưỡng các cấp]` → quyết định bảng giá sỉ áp dụng khi báo giá.

### 6.6 Sản phẩm, bảng giá sỉ & báo giá
**Sản phẩm**: đồng bộ từ WooCommerce (5.6); bổ sung trong hệ thống: quy cách thùng (số đơn vị/thùng), đơn vị bán sỉ, hiển thị/ẩn khi báo giá.

**Bảng giá sỉ** (`PriceList`): mỗi cấp khách 1 bảng giá; mỗi dòng: sản phẩm, giá sỉ/đơn vị, số lượng tối thiểu, bậc giá theo số lượng (tùy chọn), hiệu lực từ–đến. Import/xuất Excel. Chỉ Owner/Manager sửa.

**Báo giá** (`Quote`):
- Tạo từ trang khách/hội thoại: chọn sản phẩm (tìm theo tên/SKU/danh mục, lọc còn hàng), số lượng → giá tự lấy theo cấp khách; sales được giảm thêm tối đa `quote.maxExtraDiscountPct` (mặc định 0%, Owner đặt), vượt mức → cần Owner duyệt.
- Trạng thái: `DRAFT` → `SENT` → `ACCEPTED` / `REJECTED` / `EXPIRED` (mặc định hiệu lực 7 ngày).
- Xuất **PDF có logo Michio**, thông tin công ty (tên, địa chỉ, hotline, website), thông tin khách, bảng hàng (ảnh nhỏ, tên, SKU, quy cách, SL, đơn giá, thành tiền), tổng, ghi chú điều kiện (giao hàng, thanh toán), tên + SĐT sales. Lưu file S3, có link chia sẻ có hạn.
- Gửi qua Messenger ngay trong hộp thư, hoặc tải về để gửi Zalo.
- Gửi báo giá tự động chuyển deal sang `BAO_GIA` và tạo task "Follow-up báo giá" sau 2 ngày làm việc.
- Báo giá `ACCEPTED` → chuyển thành Đơn sỉ bằng 1 nút.

### 6.7 Đơn sỉ (ghi nhận, không quản lý kho)
- Trường: khách, sales, ngày đặt, dòng hàng (sản phẩm, SL, đơn giá, chiết khấu), phí vận chuyển, tổng tiền, địa chỉ giao, phương thức thanh toán (chuyển khoản / tiền mặt / công nợ), trạng thái thanh toán (`UNPAID`, `PARTIAL`, `PAID`), trạng thái giao (`PENDING`, `PACKING`, `SHIPPING`, `DELIVERED`, `CANCELLED`), mã vận đơn, ghi chú.
- SUPPORT (kế toán/kho) cập nhật trạng thái giao & thanh toán; sales nhận thông báo khi đơn được giao xong.
- Đơn đầu tiên chuyển khách sang `NEW_CUSTOMER`; khách được gán sales phụ trách vĩnh viễn (tới khi chuyển giao).
- Doanh số tính theo đơn **không bị hủy**, theo ngày đặt (cấu hình: hoặc theo ngày đã thanh toán).
- Xuất Excel danh sách đơn để kế toán nhập phần mềm kế toán/kho hiện có `[CẦN XÁC NHẬN phần mềm đang dùng để tích hợp sau]`.

### 6.8 Nhắc tái đặt hàng (đặc thù bán sỉ)
- Mỗi khách có `reorderCycleDays`: mặc định 30; sau ≥ 3 đơn, tự tính = trung vị khoảng cách giữa các đơn (làm tròn, giới hạn 7–120 ngày); sales/Owner sửa tay được (khóa không tự tính lại).
- `nextReorderAt = lastOrderAt + reorderCycleDays`.
- Job `reorder-reminder` hằng ngày 07:30: tạo task "Nhắc tái đặt hàng" cho sales phụ trách trước `nextReorderAt` **3 ngày** (cấu hình), kèm gợi ý **5 mặt hàng khách mua nhiều nhất** và tổng đơn gần nhất.
- Khách chuyển `AT_RISK` → báo sales + Owner trong tổng kết sáng.
- Màn hình **"Khách cần chăm"**: danh sách sắp đến hạn đặt lại, quá hạn, ngủ đông; sắp xếp theo giá trị đơn trung bình.
- Nút **"Tạo đơn lặp lại"**: sao chép đơn gần nhất thành báo giá/đơn mới.

### 6.9 Task & hoạt động
- Task: `CALL`, `MESSAGE`, `SEND_QUOTE`, `FOLLOW_UP`, `REORDER`, `MEETING`, `OTHER`; hạn, người làm, liên kết lead/khách/báo giá/đơn, trạng thái `TODO`/`DONE`/`CANCELLED`, nhắc trước 15 phút.
- Quy tắc tự động (bật/tắt): follow-up báo giá (6.6), nhắc tái đặt (6.8), lead không có hoạt động > 5 ngày → cảnh báo.
- Nhắc qua Zalo Bot + web; không nhắn bot ngoài giờ trừ loại khẩn.
- **Dòng thời gian** mỗi khách: tin nhắn (tóm tắt), cuộc gọi ghi tay (kết quả: nghe máy / không nghe / hẹn gọi lại, ghi chú), báo giá, đơn, đổi giai đoạn, giao/nhận/thu hồi, task, file.

### 6.10 Chuyển giao khi nhân viên nghỉ
- Chọn sales nguồn → xem số lead mở, khách đang phụ trách, báo giá chưa chốt, task mở → chọn: giao hết cho 1 người / chia đều xoay vòng → xác nhận.
- Tùy chọn đặt sales nguồn `INACTIVE` và thu hồi đăng nhập ngay.
- Job nền, báo kết quả; người nhận được danh sách khách qua Zalo Bot.
- **AC**: 1.000 bản ghi chuyển xong < 1 phút, không mất dữ liệu, AuditLog đầy đủ.

### 6.11 Dashboard & báo cáo
**Owner** (lọc: thời gian, sales, nguồn, mô hình kinh doanh, tỉnh):
- Lead mới theo nguồn (Facebook / Zalo công ty / Form web / khác), lead chờ nhận, lead quá hạn.
- FRT trung vị & P90; tỷ lệ nhận đúng hạn; số lần thu hồi.
- Phễu: Lead → Đã liên hệ → Báo giá → Chốt; tỷ lệ chốt theo nguồn, theo mô hình kinh doanh, theo mức nhập.
- Doanh số theo ngày/tuần/tháng; số đơn; giá trị đơn trung bình; doanh số khách mới vs khách cũ.
- **So sánh 3 sales**: lead nhận, FRT, số hoạt động, báo giá gửi, đơn, doanh số, tỷ lệ chốt, % chỉ tiêu.
- Khách: số khách mới/tháng, tỷ lệ quay lại, số khách AT_RISK/DORMANT.
- Nhóm hàng / sản phẩm bán chạy theo doanh số sỉ.
- Lý do thua.

**Sales**: lead chờ nhận (đếm ngược), việc hôm nay, khách cần nhắc tái đặt, doanh số tháng vs chỉ tiêu.

**Chỉ tiêu**: Owner đặt chỉ tiêu tháng cho từng sales (doanh số, số khách mới, số đơn).

**Định nghĩa chỉ số** (`packages/core/src/metrics.ts`, dùng thống nhất):
- FRT = `firstContactAt − firstAssignedAt` (giờ làm việc).
- Tỷ lệ nhận đúng hạn = assignment ACCEPTED trước hạn / tổng assignment tự động.
- Tỷ lệ chốt = deal CHOT / (CHOT + THUA), theo ngày đóng.
- Doanh số = tổng `Order.total` đơn không hủy, theo `orderedAt`.
- Tỷ lệ quay lại (quý) = khách có ≥ 1 đơn trong quý và đã có đơn trước quý / khách có đơn trước quý.

Xuất Excel mọi báo cáo theo bộ lọc hiện tại.

### 6.12 Thông báo, audit, cài đặt
- Thông báo: web (chuông + SSE), Zalo Bot, email (cảnh báo hệ thống, báo cáo tuần cho Owner). Người dùng tự bật/tắt từng loại (trừ "được giao lead").
- Audit log: người làm, thời điểm, kênh (`WEB`, `ZALO_BOT`, `API`, `SYSTEM`), hành động, đối tượng, trước/sau. Không sửa/xóa được.
- Cài đặt: thông tin công ty (dùng trên PDF), giờ làm việc & ngày lễ, giai đoạn pipeline, lý do thua, nguồn lead, tag, cấp khách & bảng giá, chu kỳ tái đặt, luật chia lead (có nút **"Thử luật"** nhập lead giả để xem ai nhận), thời hạn, mẫu trả lời nhanh, tích hợp (Facebook, Zalo Bot, Zalo công ty, WooCommerce, API key website).

---

## 7. Data model (Prisma)

> Mọi bảng có `orgId`, `createdAt`, `updatedAt`; bảng nghiệp vụ chính có `deletedAt`. Id `cuid()`. Tiền: `Decimal(18,0)` VND.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Organization {
  id        String   @id @default(cuid())
  name      String
  timezone  String   @default("Asia/Ho_Chi_Minh")
  profile   Json?    // địa chỉ, hotline, website, mst, logoUrl — dùng cho PDF
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum Role { OWNER MANAGER SALES SUPPORT VIEWER }
enum UserStatus { AVAILABLE BUSY OFF INACTIVE }

model User {
  id            String     @id @default(cuid())
  orgId         String
  email         String
  phone         String?
  fullName      String
  passwordHash  String
  role          Role
  status        UserStatus @default(AVAILABLE)
  maxOpenLeads  Int        @default(40)
  zaloBotChatId String?    @unique
  lastLoginAt   DateTime?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  deletedAt     DateTime?
  @@unique([orgId, email])
}

model Team {                      // v1 có 1 đội "Kinh doanh sỉ"; giữ để mở rộng
  id      String @id @default(cuid())
  orgId   String
  name    String
  members TeamMember[]
}
model TeamMember {
  teamId String
  userId String
  weight Int  @default(1)
  team   Team @relation(fields: [teamId], references: [id])
  @@id([teamId, userId])
}

model UserLeave { id String @id @default(cuid()) userId String startAt DateTime endAt DateTime reason String? }

model WorkingCalendar {
  id     String @id @default(cuid())
  orgId  String
  weekly Json   // [{dow:1..6, ranges:[["08:00","12:00"],["13:30","17:30"]]}]; dow 0 (CN) không có
}
model Holiday {
  id    String   @id @default(cuid())
  orgId String
  date  DateTime @db.Date
  name  String
  @@unique([orgId, date])
}

enum ChannelType { FACEBOOK_PAGE ZALO_COMPANY ZALO_BOT ZALO_OA WEBSITE WOOCOMMERCE }
enum ChannelStatus { ACTIVE DISCONNECTED ERROR DISABLED }

model ChannelAccount {
  id             String        @id @default(cuid())
  orgId          String
  type           ChannelType
  name           String        // "Facebook Michio", "Zalo công ty 0337850791"
  externalId     String        // page_id / zalo uid / bot id / site url
  status         ChannelStatus @default(ACTIVE)
  credentials    Bytes?        // JSON mã hóa AES-256-GCM
  tokenExpiresAt DateTime?
  riskAcknowledgedById String? // bắt buộc với ZALO_COMPANY chế độ B
  meta           Json?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@unique([orgId, type, externalId])
}

enum BusinessModel { JAPAN_STORE ONLINE_SHOP MINIMART RETAIL_AGENT CAFE DISTRIBUTOR OTHER }
enum OrderBand { LT_5M B5_10M B10_30M B30_50M GT_50M UNKNOWN }
enum Lifecycle { PROSPECT NEW_CUSTOMER REPEAT AT_RISK DORMANT }

model Customer {                  // = khách sỉ (shop/doanh nghiệp) + người liên hệ chính
  id                String        @id @default(cuid())
  orgId             String
  contactName       String
  phone             String?       // E.164
  email             String?
  shopName          String?
  taxCode           String?
  businessModel     BusinessModel?
  expectedOrderBand OrderBand?
  interestCategories String[]
  province          String?
  address           String?
  facebookUrl       String?
  zaloPhone         String?
  avatarUrl         String?
  tier              String?       // SI_1 | SI_2 | DAI_LY ...
  priceListId       String?
  ownerId           String?       // sales phụ trách
  lifecycle         Lifecycle     @default(PROSPECT)
  firstOrderAt      DateTime?
  lastOrderAt       DateTime?
  orderCount        Int           @default(0)
  totalRevenue      Decimal       @db.Decimal(18, 0) @default(0)
  reorderCycleDays  Int           @default(30)
  reorderCycleLocked Boolean      @default(false)
  nextReorderAt     DateTime?
  tags              String[]
  note              String?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  deletedAt         DateTime?
  identities        CustomerIdentity[]
  @@index([orgId, phone])
  @@index([orgId, ownerId, lifecycle])
  @@index([orgId, nextReorderAt])
}

model CustomerIdentity {
  id               String   @id @default(cuid())
  customerId       String
  channelAccountId String
  externalUserId   String   // PSID / zalo uid
  displayName      String?
  customer         Customer @relation(fields: [customerId], references: [id])
  @@unique([channelAccountId, externalUserId])
}

enum LeadSource { WEBSITE_WHOLESALE_FORM WEBSITE_AGENT_FORM FACEBOOK_MESSENGER FACEBOOK_LEAD_ADS ZALO_COMPANY ZALO_OA HOTLINE REFERRAL IMPORT MANUAL OTHER }
enum LeadStatus { NEW UNASSIGNED ASSIGNED IN_PROGRESS WON LOST }
enum Priority { HOT WARM COLD }

model Lead {
  id                   String     @id @default(cuid())
  code                 Int        // số ngắn tăng dần theo org, dùng cho lệnh bot
  orgId                String
  customerId           String
  source               LeadSource
  isRepurchase         Boolean    @default(false)
  campaign             String?
  utm                  Json?
  formPayload          Json?      // dữ liệu gốc từ form/lead ads
  status               LeadStatus @default(NEW)
  priority             Priority   @default(COLD)
  need                 String?
  ownerId              String?
  firstAssignedAt      DateTime?
  acceptedAt           DateTime?
  firstContactAt       DateTime?
  firstContactDeadline DateTime?
  lastActivityAt       DateTime?
  reassignCount        Int        @default(0)
  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt
  deletedAt            DateTime?
  @@unique([orgId, code])
  @@index([orgId, ownerId, status])
  @@index([orgId, status, createdAt])
}

enum AssignmentStatus { PENDING ACCEPTED RETURNED EXPIRED REASSIGNED }
enum AssignmentMethod { ROUND_ROBIN WEIGHTED LEAST_LOADED MANUAL TRANSFER CUSTOMER_OWNER PREVIOUS_OWNER }

model LeadAssignment {
  id             String           @id @default(cuid())
  leadId         String
  userId         String
  ruleId         String?
  method         AssignmentMethod
  status         AssignmentStatus @default(PENDING)
  assignedById   String?
  acceptDeadline DateTime?
  respondedAt    DateTime?
  returnReason   String?
  createdAt      DateTime         @default(now())
  @@index([leadId])
  @@index([userId, status])
}

enum FallbackAction { NEXT_RULE QUEUE }

model AssignmentRule {
  id                     String           @id @default(cuid())
  orgId                  String
  name                   String
  priority               Int
  isActive               Boolean          @default(true)
  conditions             Json             // zod-validated
  targetUserIds          String[]
  method                 AssignmentMethod
  autoAccept             Boolean          @default(false)
  acceptSlaMinutes       Int              @default(10)
  hotAcceptSlaMinutes    Int              @default(5)
  firstContactSlaMinutes Int              @default(30)
  maxReassign            Int              @default(3)
  fallback               FallbackAction   @default(QUEUE)
  rrCursor               Int              @default(0)
  weightState            Json?
  createdAt              DateTime         @default(now())
  updatedAt              DateTime         @updatedAt
}

model Conversation {
  id               String    @id @default(cuid())
  orgId            String
  channelAccountId String
  customerId       String
  leadId           String?
  externalThreadId String
  lastMessageAt    DateTime?
  lastInboundAt    DateTime?
  unreadCount      Int       @default(0)
  isResolved       Boolean   @default(false)
  @@unique([channelAccountId, externalThreadId])
  @@index([orgId, lastMessageAt])
}

enum MessageDirection { IN OUT NOTE }
enum MessageStatus { QUEUED SENT DELIVERED FAILED RECEIVED }

model Message {
  id                String           @id @default(cuid())
  conversationId    String
  direction         MessageDirection
  kind              String           // text | image | file | sticker | quote_pdf | product
  text              String?
  attachments       Json?
  externalMessageId String?
  status            MessageStatus
  error             String?
  sentByUserId      String?
  idempotencyKey    String?          @unique
  createdAt         DateTime         @default(now())
  @@unique([conversationId, externalMessageId])
  @@index([conversationId, createdAt])
}

model PipelineStage {
  id          String  @id @default(cuid())
  orgId       String
  code        String  // MOI, DA_LIEN_HE, TU_VAN, BAO_GIA, CHOT, THUA
  name        String
  order       Int
  probability Int
  isWon       Boolean @default(false)
  isLost      Boolean @default(false)
  @@unique([orgId, code])
}

model Deal {
  id              String    @id @default(cuid())
  orgId           String
  leadId          String
  customerId      String
  ownerId         String
  stageId         String
  title           String
  expectedAmount  Decimal   @db.Decimal(18, 0) @default(0)
  expectedCloseAt DateTime?
  closedAt        DateTime?
  lostReasonId    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?
  @@index([orgId, ownerId, stageId])
}

model LostReason { id String @id @default(cuid()) orgId String name String isActive Boolean @default(true) }

model ProductCategory {
  id         String  @id @default(cuid())
  orgId      String
  name       String
  code       String? // MATCHA_TEA, FOOD, DRINK, HOUSEHOLD ...
  wooId      Int?
  parentId   String?
  @@unique([orgId, wooId])
}

model Product {
  id          String   @id @default(cuid())
  orgId       String
  sku         String
  name        String
  brand       String?
  categoryIds String[]
  imageUrl    String?
  productUrl  String?
  retailPrice Decimal? @db.Decimal(18, 0)
  unit        String?  // gói, chai, hộp...
  unitsPerCase Int?    // quy cách thùng
  inStock     Boolean  @default(true)
  showInQuote Boolean  @default(true)
  wooId       Int?
  wooModifiedAt DateTime?
  needsSku    Boolean  @default(false)
  isActive    Boolean  @default(true)
  @@unique([orgId, sku])
  @@unique([orgId, wooId])
}

model PriceList {
  id        String    @id @default(cuid())
  orgId     String
  name      String    // "Sỉ cấp 1", "Đại lý"
  tier      String
  validFrom DateTime?
  validTo   DateTime?
  items     PriceListItem[]
}
model PriceListItem {
  id          String    @id @default(cuid())
  priceListId String
  productId   String
  price       Decimal   @db.Decimal(18, 0)
  minQty      Int       @default(1)
  qtyBreaks   Json?     // [{minQty:24, price:...}]
  priceList   PriceList @relation(fields: [priceListId], references: [id])
  @@unique([priceListId, productId])
}

enum QuoteStatus { DRAFT PENDING_APPROVAL SENT ACCEPTED REJECTED EXPIRED }

model Quote {
  id          String      @id @default(cuid())
  code        String      // BG-2026-000123
  orgId       String
  customerId  String
  dealId      String?
  ownerId     String
  status      QuoteStatus @default(DRAFT)
  items       Json        // [{productId, sku, name, unit, qty, unitPrice, discountPct, lineTotal}]
  subtotal    Decimal     @db.Decimal(18, 0)
  discount    Decimal     @db.Decimal(18, 0) @default(0)
  shippingFee Decimal     @db.Decimal(18, 0) @default(0)
  total       Decimal     @db.Decimal(18, 0)
  validUntil  DateTime
  terms       String?
  pdfKey      String?
  approvedById String?
  sentAt      DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  @@unique([orgId, code])
}

enum PaymentStatus { UNPAID PARTIAL PAID }
enum DeliveryStatus { PENDING PACKING SHIPPING DELIVERED CANCELLED }
enum PaymentMethod { BANK_TRANSFER CASH CREDIT }

model Order {
  id             String         @id @default(cuid())
  code           String         // DH-2026-000456
  orgId          String
  customerId     String
  ownerId        String
  quoteId        String?
  dealId         String?
  orderedAt      DateTime
  items          OrderItem[]
  subtotal       Decimal        @db.Decimal(18, 0)
  discount       Decimal        @db.Decimal(18, 0) @default(0)
  shippingFee    Decimal        @db.Decimal(18, 0) @default(0)
  total          Decimal        @db.Decimal(18, 0)
  paymentMethod  PaymentMethod
  paymentStatus  PaymentStatus  @default(UNPAID)
  paidAmount     Decimal        @db.Decimal(18, 0) @default(0)
  deliveryStatus DeliveryStatus @default(PENDING)
  trackingCode   String?
  shippingAddress String?
  note           String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  deletedAt      DateTime?
  @@unique([orgId, code])
  @@index([orgId, customerId, orderedAt])
  @@index([orgId, ownerId, orderedAt])
}
model OrderItem {
  id        String  @id @default(cuid())
  orderId   String
  productId String
  qty       Decimal @db.Decimal(18, 2)
  unitPrice Decimal @db.Decimal(18, 0)
  discount  Decimal @db.Decimal(18, 0) @default(0)
  lineTotal Decimal @db.Decimal(18, 0)
  order     Order   @relation(fields: [orderId], references: [id])
}

enum TaskType { CALL MESSAGE SEND_QUOTE FOLLOW_UP REORDER MEETING OTHER }
enum TaskStatus { TODO DONE CANCELLED }

model Task {
  id                  String     @id @default(cuid())
  orgId               String
  title               String
  type                TaskType
  status              TaskStatus @default(TODO)
  dueAt               DateTime
  remindBeforeMinutes Int        @default(15)
  assigneeId          String
  createdById         String?
  customerId          String?
  leadId              String?
  quoteId             String?
  orderId             String?
  note                String?
  completedAt         DateTime?
  autoRuleKey         String?    // "reorder:{customerId}:{yyyy-mm-dd}" để không tạo trùng
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  @@unique([orgId, autoRuleKey])
  @@index([assigneeId, status, dueAt])
}

enum ActivityType { NOTE CALL MEETING MESSAGE_IN MESSAGE_OUT STAGE_CHANGE ASSIGNMENT QUOTE ORDER TASK_DONE MERGE SYSTEM }

model Activity {
  id         String       @id @default(cuid())
  orgId      String
  customerId String?
  leadId     String?
  userId     String?
  type       ActivityType
  data       Json
  createdAt  DateTime     @default(now())
  @@index([customerId, createdAt])
}

model Target {
  id           String  @id @default(cuid())
  orgId        String
  userId       String
  month        String  // "2026-11"
  revenue      Decimal @db.Decimal(18, 0)
  newCustomers Int?
  orders       Int?
  @@unique([userId, month])
}

model QuickReply { id String @id @default(cuid()) orgId String shortcut String content String createdById String? }

model Notification {
  id         String    @id @default(cuid())
  userId     String
  type       String
  title      String
  body       String
  link       String?
  readAt     DateTime?
  sentZaloAt DateTime?
  createdAt  DateTime  @default(now())
  @@index([userId, readAt])
}

model BotLinkCode { code String @id userId String expiresAt DateTime }

model ApiKey { id String @id @default(cuid()) orgId String name String hash String source LeadSource lastUsedAt DateTime? revokedAt DateTime? }

model WebhookEvent {
  id          String    @id @default(cuid())
  source      String    // facebook | zalo-bot | zalo-company | website | woocommerce
  eventKey    String    @unique
  payload     Json
  status      String    // RECEIVED | PROCESSED | FAILED
  error       String?
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
}

model AuditLog {
  id         String   @id @default(cuid())
  orgId      String
  actorId    String?
  via        String   // WEB | ZALO_BOT | API | SYSTEM
  action     String
  entityType String
  entityId   String
  before     Json?
  after      Json?
  ip         String?
  createdAt  DateTime @default(now())
  @@index([orgId, entityType, entityId])
  @@index([orgId, createdAt])
}

model Setting {
  orgId String
  key   String
  value Json
  @@id([orgId, key])
}
```

### 7.1 Setting mặc định (seed)
| Key | Mặc định |
|---|---|
| `sla.businessHoursOnly` | `true` |
| `assignment.outOfHoursMode` | `"ASSIGN_NOW"` (hoặc `"HOLD"`) |
| `assignment.keepCustomerOwner` | `true` |
| `assignment.preferPreviousOwner` | `true` |
| `assignment.reclaimOnContactSlaBreach` | `false` |
| `priority.byOrderBand` | `{"GT_50M":"HOT","B30_50M":"HOT","B10_30M":"WARM","B5_10M":"WARM","LT_5M":"COLD","UNKNOWN":"COLD"}` |
| `quote.validDays` | `7` |
| `quote.maxExtraDiscountPct` | `0` |
| `quote.followUpBusinessDays` | `2` |
| `reorder.defaultCycleDays` | `30` |
| `reorder.remindBeforeDays` | `3` |
| `reorder.dormantDays` | `90` |
| `lead.staleDays` | `5` |
| `notify.dailyDigestTime` | `"08:00"` |
| `notify.zaloOutsideHours` | `false` |
| `facebook.standardWindowHours` | **theo tài liệu Meta** |
| `facebook.useHumanAgentTag` | `false` (bật khi đủ điều kiện) |
| `zaloCompany.mode` | `"QUICK_CAPTURE"` (hoặc `"GATEWAY"`) |
| `zaloCompany.minSecondsBetweenMessages` | `3` |
| `zaloCompany.maxMessagesPerDay` | `300` |
| `woo.syncIntervalHours` | `6` |

---

## 8. API (REST, `/api/v1`)

Quy ước: JSON camelCase; phân trang `?cursor=&limit=` (mặc định 20, tối đa 100); lỗi `{ error: { code, message, details? } }`; mọi endpoint trừ `public`/`webhooks`/`health` cần session.

| Method | Path | Mô tả | Quyền |
|---|---|---|---|
| POST | `/auth/login` · `/auth/logout` · `/auth/forgot` · `/auth/reset` | Xác thực | public |
| GET | `/me` · PATCH `/me/status` · POST `/me/zalo-bot/link-code` | Bản thân | all |
| CRUD | `/users`; POST `/users/:id/deactivate`; CRUD `/users/:id/leaves` | Người dùng | Owner |
| GET/POST | `/leads` (lọc: status, ownerId, source, priority, businessModel, province, q, from/to, slaBreached) | Lead | scope |
| POST | `/leads/quick` `{phone, name, note, source}` | Lead nhanh | tạo lead |
| GET/PATCH/DELETE | `/leads/:id` | | scope |
| POST | `/leads/:id/accept` · `/return` · `/assign` · `/activities` | | |
| POST | `/leads/bulk-assign` | Giao nhiều | Owner/Manager |
| GET | `/leads/:id/timeline` | | scope |
| GET/POST | `/customers`; GET/PATCH `/customers/:id`; POST `/customers/merge` | Khách sỉ | scope |
| GET | `/customers/attention` (sắp/ quá hạn tái đặt, AT_RISK, DORMANT) | Khách cần chăm | scope |
| GET | `/customers/:id/top-products` | 5 mặt hàng mua nhiều | scope |
| POST | `/imports/customers` (multipart) → GET `/imports/:id` | Import | Owner/Manager |
| GET | `/conversations`; GET/POST `/conversations/:id/messages`; POST `/conversations/:id/notes`; PATCH `/conversations/:id` | Hộp thư | scope |
| GET | `/conversations/:id/can-send` | Kiểm tra khung nhắn | scope |
| CRUD | `/deals`; POST `/deals/:id/stage` | Pipeline | scope |
| GET | `/products` (q, categoryId, inStock) · `/product-categories`; PATCH `/products/:id` | Sản phẩm | all / Owner sửa |
| CRUD | `/price-lists`, `/price-lists/:id/items`; POST `/price-lists/:id/import`; GET `/price-lists/:id/export` | Bảng giá sỉ | Owner/Manager |
| POST | `/pricing/resolve` `{customerId, items:[{productId, qty}]}` | Tính giá theo cấp khách | scope |
| CRUD | `/quotes`; POST `/quotes/:id/approve` · `/send` · `/accept` · `/reject` · `/to-order`; GET `/quotes/:id/pdf` | Báo giá | scope |
| CRUD | `/orders`; PATCH `/orders/:id/payment` · `/delivery`; POST `/orders/:id/repeat` | Đơn sỉ | scope / Support |
| CRUD | `/tasks`; POST `/tasks/:id/complete` | Task | scope |
| CRUD | `/assignment-rules`; POST `/assignment-rules/reorder` · `/simulate` | Luật chia | Owner/Manager |
| POST | `/transfers` → GET `/transfers/:id` | Chuyển giao | Owner/Manager |
| GET | `/reports/overview` · `/funnel` · `/sales-comparison` · `/sources` · `/revenue` · `/customers` · `/products` · `/lost-reasons` · `/sla`; GET `/reports/:name/export` | Báo cáo | scope |
| CRUD | `/targets` | Chỉ tiêu | Owner/Manager |
| GET/PUT | `/settings/:key`; CRUD `/pipeline-stages`, `/lost-reasons`, `/quick-replies`, `/holidays`, `/api-keys` | Cấu hình | Owner/Manager |
| GET/POST | `/integrations/facebook/connect` · `/callback` · `/status` | Facebook | Owner |
| POST | `/integrations/woocommerce` (lưu key) · `/integrations/woocommerce/sync` | WooCommerce | Owner |
| GET/POST | `/integrations/zalo-company/qr` · `/status` · `/disconnect` | Zalo công ty (chế độ B) | Owner |
| GET | `/audit-logs` | | Owner/Manager |
| GET | `/events/stream` | SSE | all |
| GET/POST | `/notifications`, `/notifications/read` | | all |
| POST | `/public/leads` | Nhận lead từ website | X-Api-Key |
| GET/POST | `/webhooks/facebook` · POST `/webhooks/zalo-bot` · `/webhooks/woocommerce` · `/webhooks/zalo-oa` (501) | Webhook | chữ ký |
| GET | `/health` | DB, Redis, trạng thái từng kênh | public |

SSE events: `lead.assigned`, `lead.updated`, `assignment.expiring`, `message.new`, `task.due`, `order.updated`, `notification.new`.

---

## 9. Background jobs

| Queue / job | Kích hoạt | Mô tả |
|---|---|---|
| `channel-inbound` | webhook FB / Zalo công ty | Xử lý tin & lead |
| `channel-outbound` | gửi tin | Retry backoff 5 lần |
| `zalo-bot-inbound` | webhook bot | Parse & thực thi lệnh |
| `zalo-bot-notify` | sự kiện | Gửi thông báo (throttle) |
| `assignment` | lead.created / return / expire | Engine chia lead |
| `sla-check` | delayed | Thu hồi / cảnh báo |
| `sla-sweeper` | mỗi phút | Lưới an toàn |
| `out-of-hours-release` | 08:00 T2–T7 | Khi `outOfHoursMode=HOLD` |
| `task-reminder` | mỗi phút | Nhắc task |
| `quote-expiry` | mỗi giờ | Báo giá hết hạn → EXPIRED |
| `reorder-reminder` | 07:30 T2–T7 | 6.8 |
| `customer-lifecycle` | 01:00 hằng ngày | Cập nhật lifecycle, chu kỳ tái đặt |
| `stale-lead` | mỗi giờ | Cảnh báo lead không hoạt động |
| `daily-digest` | 08:00 T2–T7 | Tổng kết qua Zalo Bot |
| `weekly-report` | 08:00 thứ 2 | Email báo cáo tuần cho Owner |
| `woo-product-sync` | 6 giờ / thủ công / webhook | 5.6 |
| `facebook-token-check` | hằng ngày | Kiểm tra token, cảnh báo sắp hết hạn |
| `quote-pdf` | khi tạo/sửa báo giá | Render PDF |
| `import`, `transfer` | yêu cầu | Job nền có tiến độ |

Mọi job **idempotent**; log kèm `jobId`, `leadId`/`customerId`; lỗi kênh cuối cùng báo Owner.

---

## 10. Giao diện

### 10.1 Nhận diện thương hiệu
- Logo: `https://michiovietnam.com/wp-content/uploads/2025/08/logo.png` (hình tròn đỏ với mái đình Nhật + chữ "Michio" xanh lá, dòng phụ "JAPANESE CONSUMABLES"). Lưu vào `apps/web/public/brand/logo.png`; tạo thêm bản biểu tượng vuông (chỉ hình tròn đỏ) cho favicon/PWA icon 192/512 px `[CẦN MICHIO cung cấp file gốc SVG/PNG nền trong suốt độ phân giải cao]`.
- Màu (lấy mẫu từ logo, Claude Code kiểm tra lại bằng công cụ lấy màu trên file gốc):

| Token | Màu | Dùng cho |
|---|---|---|
| `--brand-green` | `#00A651` | Dải header, viền, icon, điểm nhấn trên nền tối (không dùng làm nền cho chữ trắng: tương phản chỉ 3.19:1) |
| `--brand-green-strong` (primary) | `#007F3E` | Nền nút chính, liên kết, trạng thái thành công (đạt AA với chữ trắng) |
| `--brand-green-dark` | `#006B34` | Hover của nút chính |
| `--brand-red` (accent) | `#E3262E` | Badge lead HOT, cảnh báo quá hạn, điểm nhấn |
| `--neutral-900` | `#1F2933` | Chữ chính |
| `--neutral-50` | `#F7F8F7` | Nền |

- Đỏ chỉ dùng làm điểm nhấn/cảnh báo, không dùng cho nút chính (tránh nhầm với lỗi).
- Font: **Be Vietnam Pro** (UI và PDF) — hiển thị tiếng Việt tốt.
- Hỗ trợ dark mode (định nghĩa token cho cả 2 chế độ). Đảm bảo tương phản AA.
- PDF báo giá: logo góc trái trên, dải màu xanh mảnh ở đầu trang, tiêu đề "BÁO GIÁ SỈ", chân trang có hotline, website, địa chỉ.

### 10.2 Màn hình
| # | Màn hình | Chính cho | Nội dung |
|---|---|---|---|
| S1 | Đăng nhập | all | Logo, email/SĐT + mật khẩu |
| S2 | Trang chủ Sales | Sales | Lead chờ nhận (đếm ngược, nút Nhận/Trả lớn), việc hôm nay, khách cần nhắc tái đặt, % chỉ tiêu tháng |
| S3 | Trang chủ Owner | Owner | Thẻ KPI, lead theo nguồn hôm nay, lead quá hạn, so sánh 3 sales, doanh số tháng |
| S4 | Lead | all | Bảng + bộ lọc, nút "+ Lead nhanh" luôn hiện (cả mobile) |
| S5 | Chi tiết khách / lead | all | Hồ sơ khách sỉ, timeline, deal, báo giá, đơn, task, hội thoại, lịch sử giao |
| S6 | Hộp thư | Sales/Owner | 3 cột (6.4); mobile: danh sách → chat → vuốt xem thẻ khách |
| S7 | Pipeline | Sales/Owner | Kanban |
| S8 | Khách cần chăm | Sales/Owner | 6.8 |
| S9 | Báo giá | Sales | Danh sách + trình tạo báo giá (tìm sản phẩm có ảnh, giá tự động, xem trước PDF) |
| S10 | Đơn sỉ | Sales/Support | Danh sách, cập nhật thanh toán/giao hàng |
| S11 | Việc của tôi | Sales | Quá hạn / Hôm nay / Sắp tới |
| S12 | Báo cáo | Owner/Viewer | Tab: Tổng quan, Nguồn, Phễu, Sales, Doanh số, Khách, Sản phẩm, Lý do thua, Tốc độ phản hồi |
| S13 | Sản phẩm & bảng giá | Owner | Danh mục đồng bộ Woo, bảng giá sỉ theo cấp |
| S14 | Chuyển giao | Owner | Wizard 3 bước |
| S15 | Chia lead | Owner | Luật, thứ tự, thời hạn, mô phỏng |
| S16 | Người dùng | Owner | |
| S17 | Cài đặt & Tích hợp | Owner | Công ty, lịch, Facebook, Zalo Bot, Zalo công ty, WooCommerce, API key |
| S18 | Hồ sơ | all | Kết nối Zalo Bot, thông báo, lịch nghỉ |
| S19 | Audit log | Owner | |

Yêu cầu UX: mobile-first cho sales; deep link từ Zalo Bot mở thẳng lead; nút `tel:` và "Mở Zalo" (`https://zalo.me/{phone}`) cạnh mọi SĐT; ngày `dd/MM/yyyy HH:mm`; tiền `12.500.000 ₫`; trạng thái rỗng, skeleton, cuộn vô hạn trên mobile.

---

## 11. Yêu cầu phi chức năng

### 11.1 Bảo mật
- HTTPS; cookie `Secure; HttpOnly; SameSite=Lax`; CSRF cho form.
- Mã hóa credentials kênh (AES-256-GCM, `ENCRYPTION_KEY`).
- Xác minh chữ ký mọi webhook (Facebook `X-Hub-Signature-256`, Zalo Bot secret header, WooCommerce `X-WC-Webhook-Signature`); chống replay.
- Rate limit đăng nhập & `/public/leads` (60 req/phút/key, honeypot).
- Log ứng dụng che SĐT (`0912***678`) và không ghi nội dung tin nhắn đầy đủ.

### 11.2 Dữ liệu cá nhân
- Tuân thủ quy định bảo vệ dữ liệu cá nhân hiện hành tại Việt Nam `[CẦN MICHIO xác nhận yêu cầu cụ thể]`; phù hợp với chính sách bảo mật đang công bố trên website (dữ liệu form dùng để liên hệ tư vấn).
- Quyền tối thiểu, audit truy cập, chức năng ẩn danh hóa (`POST /customers/:id/anonymize`) và xuất dữ liệu một khách.
- Backup PostgreSQL hằng ngày, giữ 30 ngày, kiểm thử khôi phục (ghi trong `docs/RUNBOOK.md`).

### 11.3 Hiệu năng (quy mô thiết kế)
- 10 người dùng đồng thời (dư cho tăng lên 20 sales), 50.000 khách, 15.000 sản phẩm, 3.000 lead/tháng, 30.000 tin nhắn/tháng.
- API danh sách p95 < 300 ms; dashboard < 2 giây; tìm sản phẩm khi báo giá < 200 ms (index `pg_trgm` trên tên, SKU; tìm không dấu bằng `unaccent`).

### 11.4 Độ tin cậy & quan sát
- Webhook trả 200 nhanh, xử lý qua queue, lưu `WebhookEvent` để replay (`pnpm replay:webhook --id`).
- Chia lead dùng transaction + advisory lock.
- `/health` + trang "Tình trạng hệ thống" cho Owner: hàng đợi, job lỗi, trạng thái Facebook / Zalo Bot / Zalo công ty / WooCommerce.
- Log JSON có `requestId`, `userId`.

---

## 12. Kiểm thử

| Loại | Bắt buộc |
|---|---|
| Unit | `normalizeVnPhone`, `addBusinessMinutes` (Chủ nhật, lễ, nghỉ trưa), xoay vòng bỏ qua người nghỉ, parser lệnh bot (có/không dấu), ma trận quyền, tính giá theo cấp + bậc số lượng, tính chu kỳ tái đặt, metrics |
| Integration (testcontainers) | Form web → lead → chia → hết hạn → thu hồi → chia lại; Facebook webhook idempotent; khách cũ quay lại → về đúng sales phụ trách; báo giá → đơn → lifecycle + nextReorderAt; job reorder tạo task đúng 1 lần; chuyển giao 1.000 bản ghi |
| Concurrency | 90 lead song song → 30/30/30 (±1) |
| E2E (Playwright) | Sales: nhận lead → nhắn Messenger → tạo báo giá PDF → gửi → chốt đơn. Owner: cấu hình luật → mô phỏng → xem báo cáo → chuyển giao |
| Mock | `packages/channels/test/mocks`: Facebook Graph + webhook, Zalo Bot API, WooCommerce API, form WordPress — chạy demo local không cần tài khoản thật (`MOCK_INTEGRATIONS=true`) |

Độ phủ `packages/core` ≥ 80%.

---

## 13. Lộ trình

Mỗi milestone kết thúc: test xanh, seed cập nhật, `CHANGELOG.md`, chạy được bằng `docker compose up`.

| M | Nội dung | Definition of Done |
|---|---|---|
| **M0** Nền tảng (1 tuần) | Monorepo, Docker, Prisma schema, seed (Phụ lục C), auth, phân quyền, layout có nhận diện Michio | Đăng nhập theo 5 vai trò, menu đúng quyền, test ma trận quyền xanh |
| **M1** Lead & chia lead (1,5 tuần) | Khách/lead, chống trùng, Lead nhanh, import Excel, `/public/leads` + **snippet WordPress**, chia xoay vòng + thời hạn + sweeper, S2/S4/S5/S15, SSE | Gửi form sỉ trên web (hoặc mock) → lead được chia trong < 10 giây; AC 6.3 đạt |
| **M2** Zalo Bot (1 tuần) | Liên kết tài khoản, thông báo, toàn bộ lệnh 5.5 (gồm `LEAD`), tổng kết sáng | Người trực Zalo công ty tạo lead bằng `LEAD …`, sales nhận/trả/hẹn hoàn toàn qua Zalo |
| **M3** Facebook (1,5 tuần) | Kết nối Page, webhook Messenger + Lead Ads, hộp thư S6, mẫu trả lời, kiểm tra khung nhắn. **Song song: Michio nộp Meta App Review** | Tin nhắn Page → lead tự chia; sales trả lời từ web |
| **M4** Sản phẩm, báo giá, đơn (2 tuần) | Đồng bộ WooCommerce, bảng giá sỉ, trình tạo báo giá + PDF, gửi qua Messenger, đơn sỉ, pipeline Kanban, S9/S10/S13 | Tạo báo giá 20 dòng < 2 phút; PDF đúng thương hiệu; báo giá → đơn |
| **M5** Chăm khách & báo cáo (1,5 tuần) | Lifecycle, nhắc tái đặt, S8, task tự động, dashboard S3, báo cáo S12, chỉ tiêu, xuất Excel, chuyển giao S14, audit S19 | Số liệu báo cáo khớp fixture; task tái đặt tạo đúng hạn, không trùng |
| **M6** Go-live (1 tuần) | PWA, tối ưu mobile, bảo mật, backup, RUNBOOK, `docs/HUONG-DAN.md` (hướng dẫn cho sales & Owner bằng tiếng Việt), import khách hiện có | Checklist go-live: domain + HTTPS, Meta App Review đạt, bot đã liên kết cả 3 sales, dữ liệu khách cũ đã import |
| **M7** (tùy chọn) Zalo công ty chế độ B | `apps/zalo-company-gateway` (5.3) | Bật/tắt không ảnh hưởng hệ thống chính; có xác nhận rủi ro |
| **M8** (khi có OA) Zalo OA | Hoàn thiện `packages/channels/zalo-oa` (5.4) | |
| **M9** (giai đoạn 2) AI | Tóm tắt hội thoại, gợi ý trả lời theo danh mục sản phẩm, gợi ý sản phẩm bán kèm cho khách sỉ, chấm điểm lead | |

---

## 14. Môi trường & triển khai

### 14.1 `.env.example`
```
NODE_ENV=development
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://michio:michio@localhost:5432/michio_sales
REDIS_URL=redis://localhost:6379
SESSION_SECRET=change-me
ENCRYPTION_KEY=base64-32-bytes
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=michio-sales
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123
SMTP_URL=smtp://user:pass@smtp.example.com:587
MAIL_FROM="Michio Sales Hub <no-reply@michiovietnam.com>"

# Facebook / Meta
FB_APP_ID=
FB_APP_SECRET=
FB_VERIFY_TOKEN=
FB_GRAPH_VERSION=           # điền phiên bản Graph API hiện hành

# Zalo Bot (nội bộ)
ZALO_BOT_TOKEN=
ZALO_BOT_WEBHOOK_SECRET=

# WooCommerce (quyền Read)
WOO_BASE_URL=https://michiovietnam.com
WOO_CONSUMER_KEY=
WOO_CONSUMER_SECRET=
WOO_WEBHOOK_SECRET=

# Zalo công ty chế độ B (tắt mặc định)
FEATURE_ZALO_COMPANY_GATEWAY=false

# Zalo OA (chưa dùng)
ZALO_APP_ID=
ZALO_APP_SECRET=
ZALO_OA_SECRET_KEY=

MOCK_INTEGRATIONS=true
SENTRY_DSN=
TZ=Asia/Ho_Chi_Minh
```

### 14.2 Production
- 1 VPS tại Việt Nam (2–4 vCPU, 4–8 GB RAM, 80 GB SSD) — đủ cho quy mô 11.3. Docker Compose: `web`, `worker`, `postgres`, `redis`, `minio` (hoặc S3), `caddy`, (tùy chọn) `zalo-company-gateway`.
- Tên miền gợi ý: `sales.michiovietnam.com` `[CẦN XÁC NHẬN]` — dùng cho webhook Facebook, Zalo Bot, WooCommerce.
- CI GitHub Actions: lint → typecheck → test → build image → deploy có xác nhận.

---

## 15. Việc Michio cần chuẩn bị / xác nhận

**Cần trước M1**
1. Giờ làm việc chính xác T2–T7 (giả định 08:00–17:30, nghỉ trưa 12:00–13:30).
2. Plugin form đang dùng trên WordPress và quyền chỉnh code website (hoặc người quản trị web).
3. Danh sách 3 sales (họ tên, email, SĐT) và ai trực Zalo công ty 0337850791.
4. File danh sách khách sỉ hiện có (nếu có) để import.

**Cần trước M3**
5. Quyền quản trị Facebook Page và Meta Business; có chạy quảng cáo Lead Ads không.

**Cần trước M4**
6. Các cấp khách sỉ (tên, điều kiện) và bảng giá sỉ theo mã hàng (Excel).
7. Quy cách thùng của các mã bán sỉ chính; điều kiện giao hàng, thanh toán ghi trên báo giá.
8. WooCommerce API key quyền Read.
9. Logo gốc độ phân giải cao (SVG hoặc PNG nền trong suốt).

**Quyết định**
10. Dùng Zalo công ty chế độ A (ghi nhận nhanh) hay bật thêm chế độ B (kết nối không chính thức, có rủi ro)? Có kế hoạch đăng ký Zalo OA không?
11. Doanh số tính theo ngày đặt hay ngày thanh toán? Có cần duyệt chiết khấu thêm?
12. Phần mềm kế toán/kho đang dùng (để xuất dữ liệu đơn phù hợp).
13. Chỉ tiêu tháng cho từng sales.

---

## Phụ lục A — File Excel import khách sỉ
Cột: `Tên người liên hệ*`, `Số điện thoại*`, `Tên shop/doanh nghiệp`, `Email`, `Mô hình kinh doanh`, `Mức nhập dự kiến`, `Nhóm hàng quan tâm (cách nhau dấu phẩy)`, `Tỉnh/Thành`, `Địa chỉ giao hàng`, `Cấp khách`, `Sales phụ trách (email; trống = chia xoay vòng)`, `Ngày đơn gần nhất (dd/mm/yyyy)`, `Số đơn đã mua`, `Tổng doanh số`, `Chu kỳ đặt hàng (ngày)`, `Ghi chú`.
Giá trị chữ (vd "Shop online", "10–30 triệu") được ánh xạ về mã như 5.1; không khớp → báo lỗi dòng ở bước xem trước.

## Phụ lục B — API nhận lead từ website
```http
POST /api/v1/public/leads
X-Api-Key: mk_live_xxx
Content-Type: application/json

{
  "formType": "WHOLESALE",            // WHOLESALE | AGENT
  "fullName": "Nguyễn Thị Hoa",
  "phone": "0912 345 678",
  "shopName": "Shop Mẹ & Bé Hoa",
  "email": "hoa@example.com",
  "province": "Hải Phòng",
  "businessModel": "Shop online",     // chấp nhận nhãn tiếng Việt hoặc mã
  "expectedOrderBand": "10–30 triệu",
  "interestCategories": ["Matcha & Trà", "Thực phẩm"],
  "note": "Muốn lấy matcha latte và bánh kẹo cho bé",
  "pageUrl": "https://michiovietnam.com/si-hang-nhat/",
  "utm": { "source": "facebook", "medium": "cpc", "campaign": "si-thang11" },
  "website": ""                       // honeypot — phải rỗng
}
→ 201 { "leadId": "...", "code": 1234, "duplicate": false, "assignedTo": "Trần Văn B" }
```
`docs/wordpress-snippet.md` chứa code PHP gửi request này từ hook của plugin form (dùng `wp_remote_post`, `timeout => 5`, `blocking => false`).

## Phụ lục C — Dữ liệu seed demo
- Org "Michio Việt Nam" với profile công ty (địa chỉ Kim Giang, hotline 0246.68.56.986, website, logo).
- Người dùng: 1 Owner, 1 Manager (`manager@michio.local`, để test đủ vai trò), 3 Sales (`sale1..3@michio.local`), 1 Support (kế toán), 1 Viewer — mật khẩu dev `Michio@123`.
- 1 đội "Kinh doanh sỉ"; 1 luật ROUND_ROBIN mặc định.
- Lịch T2–T7, ngày lễ VN năm hiện tại.
- Danh mục: Matcha & Trà Nhật, Thực phẩm, Bánh kẹo, Gia vị, Đồ uống, Gia dụng, Chăm sóc răng miệng, Chăm sóc cá nhân, Mẹ & Bé, Sức khỏe, Sắc đẹp.
- 40 sản phẩm mẫu (tên dạng hàng Nhật tiêu dùng; giá & SKU giả), 2 bảng giá (Sỉ cấp 1, Đại lý).
- 60 khách sỉ đủ mô hình kinh doanh & lifecycle, 80 lead đủ nguồn/trạng thái, 25 báo giá, 40 đơn trải 6 tháng (để báo cáo & nhắc tái đặt có dữ liệu), 30 task, hội thoại Messenger mẫu, 8 mẫu trả lời nhanh.