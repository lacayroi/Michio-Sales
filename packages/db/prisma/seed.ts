// Demo seed (SPEC Phụ lục C). Wipes all data, then inserts a deterministic dataset relative to "now".
// Usage: pnpm db:seed   (refuses to run with NODE_ENV=production unless SEED_FORCE=1)
import { createHash } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import {
  type BusinessModel,
  type Lifecycle,
  type LeadSource,
  type LeadStatus,
  type OrderBand,
  Prisma,
  PrismaClient,
  type Priority,
} from '@prisma/client';
import {
  CATEGORIES,
  FEMALE_GIVEN,
  holidaysFor,
  INBOUND_MESSAGES,
  LAST_NAMES,
  LEAD_NEEDS,
  LOST_REASONS,
  MALE_GIVEN,
  ORG_PROFILE,
  PIPELINE_STAGES,
  PRODUCTS,
  PROVINCES,
  QUICK_REPLIES,
  SETTINGS,
  SHOP_PREFIX,
  WEEKLY_CALENDAR,
} from './seed-data';

const prisma = new PrismaClient();

export const DEV_PASSWORD = 'Michio@123';
export const DEV_WEBSITE_API_KEY = 'mk_test_michio_website_dev';

// ---------- deterministic helpers ----------
let rngState = 20261015;
function rand(): number {
  // mulberry32
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}
function pickMany<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0] as T);
  return out;
}

const NOW = new Date();
const DAY = 86_400_000;
const daysAgo = (d: number, hour = 9) => {
  const x = new Date(NOW.getTime() - d * DAY);
  x.setUTCHours(hour - 7, int(0, 59), 0, 0); // hour in ICT
  return x;
};
const daysFromNow = (d: number, hour = 10) => daysAgo(-d, hour);
const pad = (n: number, w = 6) => String(n).padStart(w, '0');
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const randomPhone = () => `+84${pick(['912', '983', '977', '868', '358', '336', '705', '789', '824', '944'])}${pad(int(0, 999999))}`;

const BUSINESS_MODELS: BusinessModel[] = ['JAPAN_STORE', 'ONLINE_SHOP', 'MINIMART', 'RETAIL_AGENT', 'CAFE', 'DISTRIBUTOR', 'OTHER'];
const ORDER_BANDS: OrderBand[] = ['LT_5M', 'B5_10M', 'B10_30M', 'B30_50M', 'GT_50M', 'UNKNOWN'];
const PRIORITY_BY_BAND = SETTINGS['priority.byOrderBand'] as Record<OrderBand, Priority>;
const FORM_CATEGORY_CODES = ['MATCHA_TEA', 'FOOD', 'DRINK', 'HOUSEHOLD', 'OTHER'];

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  // AuditLog is append-only via trigger; TRUNCATE is not blocked by row-level triggers.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== '1') {
    throw new Error('Refusing to seed in production (set SEED_FORCE=1 to override).');
  }
  if (process.env.SEED_IF_EMPTY === '1' && (await prisma.organization.count()) > 0) {
    console.log('Đã có dữ liệu — bỏ qua seed (SEED_IF_EMPTY=1).');
    return;
  }
  await wipe();

  // ---------- organization & config ----------
  const org = await prisma.organization.create({ data: { name: 'Michio Việt Nam', profile: ORG_PROFILE } });
  const orgId = org.id;

  await prisma.workingCalendar.create({ data: { orgId, weekly: WEEKLY_CALENDAR } });
  const year = NOW.getFullYear();
  const holidays = [...holidaysFor(year), ...holidaysFor(year + 1)];
  await prisma.holiday.createMany({
    data: holidays.map((h) => ({ orgId, date: new Date(`${h.date}T00:00:00Z`), name: h.name })),
    skipDuplicates: true,
  });
  await prisma.setting.createMany({
    data: Object.entries(SETTINGS).map(([key, value]) => ({ orgId, key, value: value as Prisma.InputJsonValue })),
  });

  // ---------- users ----------
  const passwordHash = await hash(DEV_PASSWORD);
  const mkUser = (email: string, fullName: string, role: 'OWNER' | 'MANAGER' | 'SALES' | 'SUPPORT' | 'VIEWER', phone: string) =>
    prisma.user.create({ data: { orgId, email, fullName, role, phone, passwordHash } });

  const owner = await mkUser('owner@michio.local', 'Nguyễn Minh Đức', 'OWNER', '+84904000001');
  await mkUser('manager@michio.local', 'Trần Thu Trang', 'MANAGER', '+84904000002');
  const sales = [
    await mkUser('sale1@michio.local', 'Lê Thị Hạnh', 'SALES', '+84904000011'),
    await mkUser('sale2@michio.local', 'Phạm Quốc Huy', 'SALES', '+84904000012'),
    await mkUser('sale3@michio.local', 'Vũ Ngọc Ánh', 'SALES', '+84904000013'),
  ];
  await mkUser('ketoan@michio.local', 'Đỗ Thị Mai', 'SUPPORT', '+84904000021');
  await mkUser('viewer@michio.local', 'Ban Giám đốc', 'VIEWER', '+84904000031');

  const team = await prisma.team.create({ data: { orgId, name: 'Kinh doanh sỉ' } });
  await prisma.teamMember.createMany({ data: sales.map((s) => ({ teamId: team.id, userId: s.id })) });

  const rule = await prisma.assignmentRule.create({
    data: {
      orgId,
      name: 'Mặc định — xoay vòng',
      priority: 1000,
      conditions: {},
      targetUserIds: sales.map((s) => s.id),
      method: 'ROUND_ROBIN',
    },
  });

  // ---------- pipeline, lost reasons, quick replies ----------
  await prisma.pipelineStage.createMany({
    data: PIPELINE_STAGES.map((s) => ({ orgId, isWon: false, isLost: false, ...s })),
  });
  const stages = Object.fromEntries((await prisma.pipelineStage.findMany({ where: { orgId } })).map((s) => [s.code, s]));
  await prisma.lostReason.createMany({ data: LOST_REASONS.map((name) => ({ orgId, name })) });
  const lostReasons = await prisma.lostReason.findMany({ where: { orgId } });
  await prisma.quickReply.createMany({
    data: QUICK_REPLIES.map(([shortcut, content]) => ({ orgId, shortcut, content, createdById: owner.id })),
  });

  // ---------- channels & api key ----------
  const fbPage = await prisma.channelAccount.create({
    data: { orgId, type: 'FACEBOOK_PAGE', name: 'Facebook Michio', externalId: 'mock-page-michio', meta: { mock: true } },
  });
  await prisma.channelAccount.create({
    data: { orgId, type: 'WEBSITE', name: 'Website michiovietnam.com', externalId: 'https://michiovietnam.com' },
  });
  await prisma.channelAccount.create({
    data: { orgId, type: 'ZALO_BOT', name: 'Zalo Bot nội bộ', externalId: 'mock-zalo-bot', meta: { mock: true } },
  });
  await prisma.apiKey.create({
    data: {
      orgId,
      name: 'Website (dev)',
      hash: createHash('sha256').update(DEV_WEBSITE_API_KEY).digest('hex'),
      source: 'WEBSITE_WHOLESALE_FORM',
    },
  });

  // ---------- catalog ----------
  const categoryByCode: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const created = await prisma.productCategory.create({
      data: { orgId, code: c.code, name: c.name, parentId: c.parent ? categoryByCode[c.parent] : null },
    });
    categoryByCode[c.code] = created.id;
  }
  await prisma.product.createMany({
    data: PRODUCTS.map(([name, cat, unit, unitsPerCase, retail], i) => ({
      orgId,
      sku: `MC-${cat.slice(0, 3)}-${pad(i + 1, 3)}`,
      name,
      categoryIds: [categoryByCode[cat] as string],
      unit,
      unitsPerCase,
      retailPrice: retail,
      inStock: i % 13 !== 7,
      imageUrl: null,
      productUrl: `https://michiovietnam.com/san-pham/demo-${i + 1}/`,
    })),
  });
  const products = await prisma.product.findMany({ where: { orgId }, orderBy: { sku: 'asc' } });

  const priceLists = {
    SI_1: await prisma.priceList.create({ data: { orgId, name: 'Sỉ cấp 1', tier: 'SI_1' } }),
    DAI_LY: await prisma.priceList.create({ data: { orgId, name: 'Đại lý', tier: 'DAI_LY' } }),
  };
  const priceOf: Record<string, Record<string, number>> = { SI_1: {}, DAI_LY: {} };
  for (const p of products) {
    const retail = Number(p.retailPrice);
    const si1 = roundTo(retail * 0.82, 500);
    const daiLy = roundTo(retail * 0.74, 500);
    priceOf.SI_1![p.id] = si1;
    priceOf.DAI_LY![p.id] = daiLy;
    const caseQty = p.unitsPerCase ?? 12;
    await prisma.priceListItem.createMany({
      data: [
        {
          priceListId: priceLists.SI_1.id,
          productId: p.id,
          price: si1,
          minQty: Math.min(6, caseQty),
          qtyBreaks: [{ minQty: caseQty, price: roundTo(si1 * 0.97, 500) }],
        },
        {
          priceListId: priceLists.DAI_LY.id,
          productId: p.id,
          price: daiLy,
          minQty: caseQty,
          qtyBreaks: [{ minQty: caseQty * 5, price: roundTo(daiLy * 0.97, 500) }],
        },
      ],
    });
  }

  // ---------- customers ----------
  // Profiles decide order history so every lifecycle state is represented.
  type Profile = { lifecycle: Lifecycle; orderGaps: number[] /* days ago for each order, newest first */ };
  const profiles: Profile[] = [];
  for (let i = 0; i < 60; i++) {
    if (i < 22) profiles.push({ lifecycle: 'PROSPECT', orderGaps: [] });
    else if (i < 32) profiles.push({ lifecycle: 'NEW_CUSTOMER', orderGaps: [int(3, 35)] });
    else if (i < 40) {
      const last = int(2, 25);
      profiles.push({ lifecycle: 'REPEAT', orderGaps: [last, last + int(25, 35), last + int(55, 70)].slice(0, int(2, 3)) });
    } else if (i < 46) profiles.push({ lifecycle: 'AT_RISK', orderGaps: i % 2 ? [int(50, 80), int(95, 120)] : [int(50, 80)] });
    else if (i < 50) profiles.push({ lifecycle: 'DORMANT', orderGaps: [int(100, 170)] });
    else profiles.push({ lifecycle: 'PROSPECT', orderGaps: [] });
  }
  // 10 + 8×(2–3) + 9 + 4 ≈ 40 orders; trim/pad REPEAT customers to exactly 40 below.
  let totalOrders = profiles.reduce((n, p) => n + p.orderGaps.length, 0);
  for (let i = 32; totalOrders < 40 && i < 40; i++) {
    const p = profiles[i]!;
    if (p.orderGaps.length < 3) {
      p.orderGaps.push(p.orderGaps[p.orderGaps.length - 1]! + int(25, 35));
      totalOrders++;
    }
  }
  for (let i = 39; totalOrders > 40 && i >= 32; i--) {
    const p = profiles[i]!;
    if (p.orderGaps.length > 2) {
      p.orderGaps.pop();
      totalOrders--;
    }
  }

  const customers = [];
  for (let i = 0; i < 60; i++) {
    const female = rand() < 0.65;
    const contactName = `${pick(LAST_NAMES)} ${pick(female ? FEMALE_GIVEN : MALE_GIVEN)}`;
    const businessModel = BUSINESS_MODELS[i % BUSINESS_MODELS.length]!;
    const province = pick(PROVINCES);
    const band = ORDER_BANDS[int(0, ORDER_BANDS.length - 1)]!;
    const profile = profiles[i]!;
    const hasOrders = profile.orderGaps.length > 0;
    const tier = businessModel === 'DISTRIBUTOR' || businessModel === 'RETAIL_AGENT' ? 'DAI_LY' : 'SI_1';
    const created = await prisma.customer.create({
      data: {
        orgId,
        contactName,
        phone: randomPhone(),
        email: rand() < 0.4 ? `khach${i + 1}@example.com` : null,
        shopName: `${pick(SHOP_PREFIX[businessModel]!)} ${contactName.split(' ').pop()} ${province.replace('TP. ', '')}`,
        businessModel,
        expectedOrderBand: band,
        interestCategories: pickMany(FORM_CATEGORY_CODES.slice(0, 4), int(1, 3)),
        province,
        address: `Số ${int(1, 200)} đường ${pick(['Lê Lợi', 'Trần Phú', 'Nguyễn Trãi', 'Hai Bà Trưng', 'Quang Trung'])}, ${province}`,
        tier: hasOrders ? tier : null,
        priceListId: hasOrders ? priceLists[tier].id : null,
        ownerId: sales[i % 3]!.id,
        lifecycle: profile.lifecycle,
        tags: rand() < 0.2 ? ['VIP'] : [],
        createdAt: daysAgo(Math.max(...profile.orderGaps, int(1, 60)) + int(3, 20)),
      },
    });
    customers.push(created);
  }

  // ---------- orders ----------
  let orderSeq = 0;
  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]!;
    const gaps = profiles[i]!.orderGaps;
    if (!gaps.length) continue;
    const tier = c.tier as 'SI_1' | 'DAI_LY';
    let revenue = 0;
    const dates: Date[] = [];
    for (const gap of [...gaps].reverse()) {
      orderSeq++;
      const orderedAt = daysAgo(gap, int(8, 16));
      dates.push(orderedAt);
      const lines = pickMany(products, int(2, 6)).map((p) => {
        const qty = (p.unitsPerCase ?? 12) * int(1, 3);
        const unitPrice = priceOf[tier]![p.id]!;
        return { productId: p.id, qty, unitPrice, discount: 0, lineTotal: qty * unitPrice };
      });
      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      const shippingFee = subtotal > 5_000_000 ? 0 : 50_000;
      const total = subtotal + shippingFee;
      const recent = gap < 7;
      const cancelled = orderSeq % 17 === 0;
      const paymentStatus = recent ? pick(['UNPAID', 'PARTIAL', 'PAID'] as const) : 'PAID';
      await prisma.order.create({
        data: {
          orgId,
          code: `DH-${orderedAt.getFullYear()}-${pad(orderSeq)}`,
          customerId: c.id,
          ownerId: c.ownerId!,
          orderedAt,
          subtotal,
          shippingFee,
          total,
          paymentMethod: pick(['BANK_TRANSFER', 'BANK_TRANSFER', 'CASH', 'CREDIT'] as const),
          paymentStatus: cancelled ? 'UNPAID' : paymentStatus,
          paidAmount: cancelled ? 0 : paymentStatus === 'PAID' ? total : paymentStatus === 'PARTIAL' ? roundTo(total / 2, 1000) : 0,
          deliveryStatus: cancelled ? 'CANCELLED' : recent ? pick(['PENDING', 'PACKING', 'SHIPPING'] as const) : 'DELIVERED',
          trackingCode: recent ? null : `VD${pad(int(100000, 999999))}`,
          shippingAddress: c.address,
          items: { create: lines },
          createdAt: orderedAt,
        },
      });
      if (!cancelled) revenue += total;
    }
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    await prisma.customer.update({
      where: { id: c.id },
      data: {
        firstOrderAt: first,
        lastOrderAt: last,
        orderCount: dates.length,
        totalRevenue: revenue,
        nextReorderAt: new Date(last.getTime() + c.reorderCycleDays * DAY),
      },
    });
  }

  // ---------- leads, assignments, deals ----------
  const SOURCES: LeadSource[] = [
    'WEBSITE_WHOLESALE_FORM',
    'WEBSITE_WHOLESALE_FORM',
    'FACEBOOK_MESSENGER',
    'FACEBOOK_MESSENGER',
    'ZALO_COMPANY',
    'ZALO_COMPANY',
    'WEBSITE_AGENT_FORM',
    'FACEBOOK_LEAD_ADS',
    'HOTLINE',
    'REFERRAL',
    'IMPORT',
    'MANUAL',
  ];
  const leads = [];
  for (let i = 0; i < 80; i++) {
    const customerIdx = i < 60 ? i : int(22, 49); // extra leads = repurchase from existing customers
    const c = customers[customerIdx]!;
    const hasOrders = profiles[customerIdx]!.orderGaps.length > 0;
    const isRepurchase = i >= 60;
    let status: LeadStatus;
    if (hasOrders && !isRepurchase) status = 'WON';
    else if (isRepurchase) status = pick(['IN_PROGRESS', 'ASSIGNED', 'WON'] as const);
    else status = (['NEW', 'UNASSIGNED', 'ASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'LOST', 'LOST'] as const)[i % 9]!;

    const source = isRepurchase ? 'ZALO_COMPANY' : SOURCES[i % SOURCES.length]!;
    const createdAt =
      hasOrders && !isRepurchase ? new Date(c.createdAt.getTime() + DAY) : status === 'NEW' || status === 'ASSIGNED' ? daysAgo(0, 9) : daysAgo(int(1, 40));
    const assigned = status !== 'NEW' && status !== 'UNASSIGNED';
    const ownerId = assigned ? c.ownerId : null;
    const accepted = status === 'IN_PROGRESS' || status === 'WON' || status === 'LOST';
    const band = c.expectedOrderBand ?? 'UNKNOWN';

    const lead = await prisma.lead.create({
      data: {
        orgId,
        code: 1001 + i,
        customerId: c.id,
        source,
        isRepurchase,
        status,
        priority: PRIORITY_BY_BAND[band],
        need: pick(LEAD_NEEDS),
        ownerId,
        firstAssignedAt: assigned ? new Date(createdAt.getTime() + 5_000) : null,
        acceptedAt: accepted ? new Date(createdAt.getTime() + int(1, 9) * 60_000) : null,
        firstContactAt: accepted ? new Date(createdAt.getTime() + int(5, 40) * 60_000) : null,
        lastActivityAt: assigned ? new Date(createdAt.getTime() + int(1, 3) * DAY) : null,
        utm: source.startsWith('WEBSITE') ? { source: 'facebook', medium: 'cpc', campaign: 'si-thang10' } : undefined,
        formPayload: source.startsWith('WEBSITE') ? { pageUrl: 'https://michiovietnam.com/si-hang-nhat/' } : undefined,
        createdAt,
      },
    });
    leads.push(lead);

    if (assigned && ownerId) {
      await prisma.leadAssignment.create({
        data: {
          leadId: lead.id,
          userId: ownerId,
          ruleId: isRepurchase ? null : rule.id,
          method: isRepurchase ? 'CUSTOMER_OWNER' : 'ROUND_ROBIN',
          status: accepted ? 'ACCEPTED' : 'PENDING',
          acceptDeadline: new Date(createdAt.getTime() + 10 * 60_000),
          respondedAt: lead.acceptedAt,
          createdAt: lead.firstAssignedAt ?? createdAt,
        },
      });
      await prisma.activity.create({
        data: { orgId, customerId: c.id, leadId: lead.id, type: 'ASSIGNMENT', data: { toUserId: ownerId, method: 'ROUND_ROBIN' }, createdAt: lead.firstAssignedAt ?? createdAt },
      });
    }
    if (accepted && ownerId) {
      await prisma.activity.create({
        data: {
          orgId,
          customerId: c.id,
          leadId: lead.id,
          userId: ownerId,
          type: 'CALL',
          data: { result: pick(['ANSWERED', 'ANSWERED', 'NO_ANSWER', 'CALL_BACK']), note: 'Đã gọi tư vấn chính sách sỉ' },
          createdAt: lead.firstContactAt ?? createdAt,
        },
      });
      const stageCode = status === 'WON' ? 'CHOT' : status === 'LOST' ? 'THUA' : pick(['DA_LIEN_HE', 'TU_VAN', 'BAO_GIA']);
      await prisma.deal.create({
        data: {
          orgId,
          leadId: lead.id,
          customerId: c.id,
          ownerId,
          stageId: stages[stageCode]!.id,
          title: `${c.shopName} — ${isRepurchase ? 'đơn lặp lại' : 'đơn đầu'}`,
          expectedAmount: roundTo(int(3, 40) * 1_000_000, 500_000),
          closedAt: status === 'WON' || status === 'LOST' ? new Date(createdAt.getTime() + int(1, 10) * DAY) : null,
          lostReasonId: status === 'LOST' ? pick(lostReasons).id : null,
          createdAt: lead.acceptedAt ?? createdAt,
        },
      });
    }
  }

  await prisma.$executeRaw`SELECT setval('lead_code_seq', (SELECT max(code) FROM "Lead"))`;

  // ---------- quotes ----------
  const deals = await prisma.deal.findMany({ where: { orgId }, include: { customer: true, stage: true } });
  const quoteDeals = [...deals.filter((d) => d.stage.code === 'BAO_GIA'), ...deals.filter((d) => d.stage.code !== 'BAO_GIA')].slice(0, 25);
  for (let i = 0; i < quoteDeals.length; i++) {
    const d = quoteDeals[i]!;
    const tier = (d.customer.tier as 'SI_1' | 'DAI_LY' | null) ?? 'SI_1';
    const items = pickMany(products, int(3, 8)).map((p) => {
      const qty = (p.unitsPerCase ?? 12) * int(1, 2);
      const unitPrice = priceOf[tier]![p.id]!;
      return { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty, unitPrice, discountPct: 0, lineTotal: qty * unitPrice };
    });
    const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
    const createdAt = new Date(d.createdAt.getTime() + DAY);
    const status =
      d.stage.code === 'CHOT' ? 'ACCEPTED' : d.stage.code === 'THUA' ? 'REJECTED' : d.stage.code === 'BAO_GIA' ? 'SENT' : pick(['DRAFT', 'SENT', 'EXPIRED'] as const);
    await prisma.quote.create({
      data: {
        orgId,
        code: `BG-${createdAt.getFullYear()}-${pad(i + 1)}`,
        customerId: d.customerId,
        dealId: d.id,
        ownerId: d.ownerId,
        status,
        items,
        subtotal,
        total: subtotal,
        validUntil: new Date(createdAt.getTime() + 7 * DAY),
        terms: 'Giao hàng toàn quốc. Thanh toán chuyển khoản trước khi giao hoặc COD.',
        sentAt: status === 'DRAFT' ? null : createdAt,
        createdAt,
      },
    });
  }

  // ---------- tasks ----------
  const TASK_TYPES = ['CALL', 'MESSAGE', 'SEND_QUOTE', 'FOLLOW_UP', 'REORDER', 'MEETING', 'OTHER'] as const;
  const TASK_TITLES: Record<(typeof TASK_TYPES)[number], string> = {
    CALL: 'Gọi lại tư vấn',
    MESSAGE: 'Nhắn Zalo gửi catalogue',
    SEND_QUOTE: 'Gửi báo giá matcha',
    FOLLOW_UP: 'Follow-up báo giá',
    REORDER: 'Nhắc tái đặt hàng',
    MEETING: 'Hẹn gặp tại cửa hàng',
    OTHER: 'Cập nhật thông tin shop',
  };
  for (let i = 0; i < 30; i++) {
    const c = customers[int(0, 49)]!;
    const type = TASK_TYPES[i % TASK_TYPES.length]!;
    const offset = int(-3, 6);
    const done = offset < 0 && i % 2 === 0;
    await prisma.task.create({
      data: {
        orgId,
        title: `${TASK_TITLES[type]} — ${c.shopName}`,
        type,
        status: done ? 'DONE' : 'TODO',
        dueAt: daysFromNow(offset, int(9, 16)),
        assigneeId: c.ownerId!,
        createdById: c.ownerId,
        customerId: c.id,
        completedAt: done ? daysFromNow(offset, 17) : null,
      },
    });
  }

  // ---------- Messenger conversations ----------
  const messengerLeads = leads.filter((l) => l.source === 'FACEBOOK_MESSENGER').slice(0, 8);
  for (const [n, lead] of messengerLeads.entries()) {
    const c = customers.find((x) => x.id === lead.customerId)!;
    const psid = `mock-psid-${1000 + n}`;
    await prisma.customerIdentity.create({
      data: { customerId: c.id, channelAccountId: fbPage.id, externalUserId: psid, displayName: c.contactName },
    });
    const start = lead.createdAt.getTime();
    const msgs = [
      { direction: 'IN' as const, text: pick(INBOUND_MESSAGES), at: start },
      { direction: 'OUT' as const, text: QUICK_REPLIES[0]![1].replace('{ten_khach}', c.contactName).replace('{ten_sales}', 'em'), at: start + 6 * 60_000 },
      { direction: 'IN' as const, text: pick(INBOUND_MESSAGES), at: start + 15 * 60_000 },
      { direction: 'OUT' as const, text: QUICK_REPLIES[2]![1], at: start + 20 * 60_000 },
    ].slice(0, int(2, 4));
    const last = msgs[msgs.length - 1]!;
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'IN')!;
    await prisma.conversation.create({
      data: {
        orgId,
        channelAccountId: fbPage.id,
        customerId: c.id,
        leadId: lead.id,
        externalThreadId: psid,
        lastMessageAt: new Date(last.at),
        lastInboundAt: new Date(lastIn.at),
        unreadCount: last.direction === 'IN' ? 1 : 0,
        messages: {
          create: msgs.map((m, k) => ({
            direction: m.direction,
            kind: 'text',
            text: m.text,
            status: m.direction === 'IN' ? 'RECEIVED' : 'SENT',
            externalMessageId: `mock-mid-${n}-${k}`,
            sentByUserId: m.direction === 'OUT' ? lead.ownerId : null,
            createdAt: new Date(m.at),
          })),
        },
      },
    });
  }

  // Document numbers continue after the seeded BG-/DH- codes (migration m4_quotes_orders).
  await prisma.$executeRaw`SELECT setval('quote_code_seq', GREATEST(1, (SELECT count(*) FROM "Quote")))`;
  await prisma.$executeRaw`SELECT setval('order_code_seq', GREATEST(1, (SELECT count(*) FROM "Order")))`;

  // ---------- targets ----------
  const month = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`;
  await prisma.target.createMany({
    data: sales.map((s, i) => ({ orgId, userId: s.id, month, revenue: [150_000_000, 120_000_000, 100_000_000][i]!, newCustomers: 5, orders: 15 })),
  });

  const counts = {
    users: await prisma.user.count(),
    customers: await prisma.customer.count(),
    leads: await prisma.lead.count(),
    quotes: await prisma.quote.count(),
    orders: await prisma.order.count(),
    tasks: await prisma.task.count(),
    products: await prisma.product.count(),
    conversations: await prisma.conversation.count(),
  };
  console.log('Seed xong:', counts);
  console.log(`Đăng nhập: owner@michio.local | manager@ | sale1..3@ | ketoan@ | viewer@ — mật khẩu ${DEV_PASSWORD}`);
  console.log(`API key website (dev): ${DEV_WEBSITE_API_KEY}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
