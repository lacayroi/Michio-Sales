// Đơn sỉ (SPEC 6.7): recorded, not stock-managed. Creating / cancelling an order updates the
// customer's purchase stats, lifecycle and reorder schedule (6.5, 6.8) in the same transaction.
import { assertAuthorized, authorize, scopeFilter } from '@michio/auth';
import type { DeliveryStatus, PaymentMethod, PaymentStatus, Prisma } from '@michio/db';
import { formatVnd, vnDayRange } from '@michio/shared';
import { z } from 'zod';
import { recordAudit } from './audit';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { computeLifecycle } from './customers';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';
import { notifyUsers } from './notifications';
import { priceLines } from './pricing';
import { getSettings } from './settings';

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

/**
 * SPEC 6.8: after ≥ 3 orders the cycle is the median gap between consecutive orders, rounded and
 * clamped to 7–120 days. Fewer orders → null (keep the default).
 */
export function computeReorderCycle(orderDates: Date[]): number | null {
  if (orderDates.length < 3) return null;
  const sorted = [...orderDates].sort((a, b) => a.getTime() - b.getTime());
  const gaps = sorted.slice(1).map((d, i) => (d.getTime() - sorted[i]!.getTime()) / DAY).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.min(120, Math.max(7, Math.round(median)));
}

/** Rebuild orderCount, revenue, first/last order, cycle, next reorder date and lifecycle from orders. */
export async function recomputeCustomerStats(tx: Tx, orgId: string, customerId: string, now: Date) {
  const [c, orders, settings] = await Promise.all([
    tx.customer.findUniqueOrThrow({ where: { id: customerId } }),
    tx.order.findMany({ where: { customerId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' } }, select: { orderedAt: true, total: true }, orderBy: { orderedAt: 'asc' } }),
    getSettings(tx, orgId, ['reorder.defaultCycleDays', 'reorder.dormantDays']),
  ]);
  const dates = orders.map((o) => o.orderedAt);
  const orderCount = orders.length;
  const lastOrderAt = dates[dates.length - 1] ?? null;
  const reorderCycleDays = c.reorderCycleLocked ? c.reorderCycleDays : (computeReorderCycle(dates) ?? settings['reorder.defaultCycleDays']);
  const data = {
    orderCount,
    totalRevenue: orders.reduce((s, o) => s + Number(o.total), 0),
    firstOrderAt: dates[0] ?? null,
    lastOrderAt,
    reorderCycleDays,
    nextReorderAt: lastOrderAt ? new Date(lastOrderAt.getTime() + reorderCycleDays * DAY) : null,
    lifecycle: computeLifecycle({ orderCount, lastOrderAt, reorderCycleDays }, now, settings['reorder.dormantDays']),
  };
  return tx.customer.update({ where: { id: customerId }, data });
}

async function nextOrderCode(tx: Tx, now: Date) {
  const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('order_code_seq')`;
  const year = new Date(vnDayRange(now).start.getTime() + 7 * 3600_000).getUTCFullYear();
  return `DH-${year}-${String(nextval).padStart(6, '0')}`;
}

const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CREDIT'] as const;

export const OrderCreateInput = z.object({
  customerId: z.string(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        qty: z.coerce.number().positive().max(1_000_000),
        /** Omitted → tier price for the customer (6.6). */
        unitPrice: z.coerce.number().int().min(0).optional(),
        /** Line discount in VND. */
        discount: z.coerce.number().int().min(0).default(0),
      }),
    )
    .min(1, 'Đơn cần ít nhất 1 dòng hàng')
    .max(200),
  shippingFee: z.coerce.number().int().min(0).default(0),
  paymentMethod: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  orderedAt: z.coerce.date().optional(),
  shippingAddress: z.string().trim().max(500).optional(),
  note: z.string().trim().max(2000).optional(),
  quoteId: z.string().optional(),
  dealId: z.string().optional(),
});

/** Close the customer's open deal as won (6.5 "Sang CHOT → tạo Đơn sỉ"), or create one for the open lead. */
async function winDeal(tx: Tx, ctx: ServiceContext, customerId: string, dealId: string | undefined, now: Date, actorId: string) {
  const won = await tx.pipelineStage.findFirst({ where: { orgId: ctx.orgId, isWon: true } });
  if (!won) return null;
  let deal = dealId ? await tx.deal.findFirst({ where: { id: dealId, orgId: ctx.orgId } }) : null;
  if (!deal) {
    const lead = await tx.lead.findFirst({ where: { customerId, status: 'IN_PROGRESS', deletedAt: null }, orderBy: { createdAt: 'desc' } });
    deal = lead ? await tx.deal.findFirst({ where: { leadId: lead.id, closedAt: null, deletedAt: null }, orderBy: { createdAt: 'desc' } }) : null;
    if (!deal && lead) {
      const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { shopName: true, contactName: true } });
      deal = await tx.deal.create({ data: { orgId: ctx.orgId, leadId: lead.id, customerId, ownerId: lead.ownerId ?? actorId, stageId: won.id, title: c.shopName ?? c.contactName, createdAt: now } });
    }
  }
  if (!deal) return null;
  if (deal.stageId !== won.id || !deal.closedAt) {
    await tx.deal.update({ where: { id: deal.id }, data: { stageId: won.id, closedAt: deal.closedAt ?? now, lostReasonId: null } });
    await tx.activity.create({ data: { orgId: ctx.orgId, customerId, leadId: deal.leadId, userId: actorId, type: 'STAGE_CHANGE', data: { from: deal.stageId, to: won.code, toName: won.name }, createdAt: now } });
  }
  const lead = await tx.lead.findUnique({ where: { id: deal.leadId } });
  if (lead && lead.status === 'IN_PROGRESS') await tx.lead.update({ where: { id: lead.id }, data: { status: 'WON', lastActivityAt: now } });
  return deal;
}

export async function createOrder(ctx: ServiceContext, raw: z.input<typeof OrderCreateInput>, opts: { tx?: Tx } = {}) {
  const actor = actorOf(ctx);
  const input = OrderCreateInput.parse(raw);
  const outbox = new Outbox(ctx.effects);
  const run = async (tx: Tx) => {
    const now = ctx.now();
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId: ctx.orgId, deletedAt: null } });
    if (!customer || !authorize(actor, 'customer.view', customer)) throw notFound('khách hàng');
    // The customer gets a permanent owner on the first order (6.7); a SALES creates orders for own customers.
    const ownerId = customer.ownerId ?? actor.id;
    assertAuthorized(actor, 'order.create', { orgId: ctx.orgId, ownerId });

    const priced = await priceLines(tx, ctx.orgId, customer, input.items.map((i) => ({ productId: i.productId, qty: Math.max(1, Math.round(i.qty)) })), now);
    const lines = input.items.map((i, k) => {
      const unitPrice = i.unitPrice ?? priced.lines[k]!.unitPrice;
      const gross = Math.round(i.qty * unitPrice);
      if (i.discount > gross) throw new DomainError('VALIDATION_ERROR', 'Chiết khấu dòng lớn hơn thành tiền');
      return { productId: i.productId, qty: i.qty, unitPrice, discount: i.discount, lineTotal: gross - i.discount };
    });
    const subtotal = lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);
    const discount = lines.reduce((s, l) => s + l.discount, 0);
    const total = subtotal - discount + input.shippingFee;
    const code = await nextOrderCode(tx, now);
    const order = await tx.order.create({
      data: {
        orgId: ctx.orgId, code, customerId: customer.id, ownerId, quoteId: input.quoteId ?? null, dealId: input.dealId ?? null,
        orderedAt: input.orderedAt ?? now, subtotal, discount, shippingFee: input.shippingFee, total,
        paymentMethod: input.paymentMethod as PaymentMethod, shippingAddress: input.shippingAddress ?? customer.address, note: input.note,
        items: { create: lines },
        createdAt: now,
      },
      include: { items: true },
    });
    if (!customer.ownerId) await tx.customer.update({ where: { id: customer.id }, data: { ownerId } });
    const deal = await winDeal(tx, ctx, customer.id, input.dealId, now, actor.id);
    if (deal && !order.dealId) await tx.order.update({ where: { id: order.id }, data: { dealId: deal.id } });
    await recomputeCustomerStats(tx, ctx.orgId, customer.id, now);
    await tx.activity.create({
      data: { orgId: ctx.orgId, customerId: customer.id, leadId: deal?.leadId ?? null, userId: actor.id, type: 'ORDER', data: { kind: 'created', orderId: order.id, code, total, quoteId: input.quoteId ?? null }, createdAt: now },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'order.create', entityType: 'Order', entityId: order.id,
      after: { code, customerId: customer.id, ownerId, total, items: lines.length, quoteId: input.quoteId ?? null }, ip: ctx.ip,
    });
    outbox.publish({ type: 'order.updated', orgId: ctx.orgId, audience: { userIds: [ownerId], roles: [...MANAGERS, 'SUPPORT'] }, data: { orderId: order.id } });
    return order;
  };
  const order = opts.tx ? await run(opts.tx) : await ctx.db.$transaction(run, TX_OPTIONS);
  await outbox.flush();
  return order;
}

async function loadOrderForFulfillment(tx: Tx, ctx: ServiceContext, orderId: string) {
  const actor = actorOf(ctx);
  const order = await tx.order.findFirst({ where: { id: orderId, orgId: ctx.orgId, deletedAt: null }, include: { customer: { select: { contactName: true, shopName: true } } } });
  if (!order || !authorize(actor, 'order.view', order)) throw notFound('đơn hàng');
  assertAuthorized(actor, 'order.updateFulfillment', order);
  return { actor, order };
}

export const PaymentInput = z.object({
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']),
  paidAmount: z.coerce.number().int().min(0).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
});

/** Kế toán / Owner cập nhật thanh toán (SPEC 6.7, §3). */
export async function updateOrderPayment(ctx: ServiceContext, orderId: string, raw: z.input<typeof PaymentInput>) {
  const input = PaymentInput.parse(raw);
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const { actor, order } = await loadOrderForFulfillment(tx, ctx, orderId);
    const total = Number(order.total);
    const paidAmount = input.paymentStatus === 'PAID' ? total : input.paymentStatus === 'UNPAID' ? 0 : (input.paidAmount ?? Number(order.paidAmount));
    if (input.paymentStatus === 'PARTIAL' && !(paidAmount > 0 && paidAmount < total)) throw new DomainError('VALIDATION_ERROR', `Thanh toán một phần phải lớn hơn 0 và nhỏ hơn ${formatVnd(total)}`);
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: input.paymentStatus as PaymentStatus, paidAmount, ...(input.paymentMethod ? { paymentMethod: input.paymentMethod as PaymentMethod } : {}) },
    });
    if (input.paymentStatus === 'PAID' && order.paymentStatus !== 'PAID') {
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: order.customerId, userId: actor.id, type: 'ORDER', data: { kind: 'paid', orderId: order.id, code: order.code, total }, createdAt: ctx.now() } });
    }
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'order.payment', entityType: 'Order', entityId: order.id,
      before: { paymentStatus: order.paymentStatus, paidAmount: Number(order.paidAmount) }, after: { paymentStatus: updated.paymentStatus, paidAmount }, ip: ctx.ip,
    });
    outbox.publish({ type: 'order.updated', orgId: ctx.orgId, audience: { userIds: [order.ownerId], roles: [...MANAGERS, 'SUPPORT'] }, data: { orderId: order.id } });
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

export const DeliveryInput = z.object({
  deliveryStatus: z.enum(['PENDING', 'PACKING', 'SHIPPING', 'DELIVERED', 'CANCELLED']),
  trackingCode: z.string().trim().max(100).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

/** Kho / kế toán cập nhật giao hàng; giao xong → báo sales (6.7); hủy → doanh số & vòng đời tính lại. */
export async function updateOrderDelivery(ctx: ServiceContext, orderId: string, raw: z.input<typeof DeliveryInput>) {
  const input = DeliveryInput.parse(raw);
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const { actor, order } = await loadOrderForFulfillment(tx, ctx, orderId);
    if (order.deliveryStatus === 'CANCELLED' && input.deliveryStatus !== 'CANCELLED') throw new DomainError('INVALID_STATE', 'Đơn đã hủy, không thể cập nhật giao hàng');
    const now = ctx.now();
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { deliveryStatus: input.deliveryStatus as DeliveryStatus, ...(input.trackingCode !== undefined ? { trackingCode: input.trackingCode } : {}) },
    });
    const changed = order.deliveryStatus !== input.deliveryStatus;
    if (changed && input.deliveryStatus === 'CANCELLED') {
      await recomputeCustomerStats(tx, ctx.orgId, order.customerId, now);
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: order.customerId, userId: actor.id, type: 'ORDER', data: { kind: 'cancelled', orderId: order.id, code: order.code, reason: input.reason ?? null }, createdAt: now } });
    }
    if (changed && input.deliveryStatus === 'DELIVERED') {
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: order.customerId, userId: actor.id, type: 'ORDER', data: { kind: 'delivered', orderId: order.id, code: order.code }, createdAt: now } });
      if (order.ownerId !== actor.id) {
        await notifyUsers(tx, outbox, ctx.orgId, [order.ownerId], {
          type: 'order.delivered',
          title: `📦 Đơn ${order.code} đã giao xong`,
          body: `${order.customer.shopName ?? order.customer.contactName} · ${formatVnd(order.total)}`,
          link: `/don-hang/${order.id}`,
        });
      }
    }
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'order.delivery', entityType: 'Order', entityId: order.id,
      before: { deliveryStatus: order.deliveryStatus, trackingCode: order.trackingCode }, after: { deliveryStatus: updated.deliveryStatus, trackingCode: updated.trackingCode, reason: input.reason ?? null }, ip: ctx.ip,
    });
    outbox.publish({ type: 'order.updated', orgId: ctx.orgId, audience: { userIds: [order.ownerId], roles: [...MANAGERS, 'SUPPORT'] }, data: { orderId: order.id } });
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

// ---------- read ----------

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess((v) => (typeof v === 'string' && v ? v.split(',') : v), z.array(z.enum(values)).optional());

export const OrderListFilters = z.object({
  q: z.string().trim().max(100).optional(),
  customerId: z.string().optional(),
  ownerId: z.string().optional(),
  paymentStatus: csv(['UNPAID', 'PARTIAL', 'PAID']),
  deliveryStatus: csv(['PENDING', 'PACKING', 'SHIPPING', 'DELIVERED', 'CANCELLED']),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(20),
});

function orderWhere(ctx: ServiceContext, f: z.output<typeof OrderListFilters>): Prisma.OrderWhereInput {
  const actor = actorOf(ctx);
  const where: Prisma.OrderWhereInput = { ...scopeFilter(actor, 'order'), deletedAt: null };
  if (f.customerId) where.customerId = f.customerId;
  if (f.ownerId) where.ownerId = f.ownerId;
  if (f.paymentStatus?.length) where.paymentStatus = { in: f.paymentStatus as PaymentStatus[] };
  if (f.deliveryStatus?.length) where.deliveryStatus = { in: f.deliveryStatus as DeliveryStatus[] };
  if (f.from || f.to) where.orderedAt = { gte: f.from, lt: f.to };
  if (f.q) {
    where.OR = [
      { code: { contains: f.q, mode: 'insensitive' } },
      { customer: { OR: [{ contactName: { contains: f.q, mode: 'insensitive' } }, { shopName: { contains: f.q, mode: 'insensitive' } }] } },
      { trackingCode: { contains: f.q, mode: 'insensitive' } },
    ];
  }
  return where;
}

export async function listOrders(ctx: ServiceContext, raw: z.input<typeof OrderListFilters>) {
  const f = OrderListFilters.parse(raw);
  const limit = Math.min(f.limit, 100);
  const where = orderWhere(ctx, f);
  const [rows, sum] = await Promise.all([
    ctx.db.order.findMany({
      where,
      orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
      include: { customer: { select: { id: true, contactName: true, shopName: true, province: true } }, owner: { select: { id: true, fullName: true } } },
    }),
    ctx.db.order.aggregate({ where: { ...where, deliveryStatus: { not: 'CANCELLED' } }, _sum: { total: true }, _count: true }),
  ]);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null, totals: { count: sum._count, revenue: Number(sum._sum.total ?? 0) } };
}

export async function getOrder(ctx: ServiceContext, orderId: string) {
  const actor = actorOf(ctx);
  const order = await ctx.db.order.findFirst({
    where: { id: orderId, orgId: ctx.orgId, deletedAt: null },
    include: {
      items: { include: { product: { select: { sku: true, name: true, unit: true, imageUrl: true } } } },
      customer: { select: { id: true, contactName: true, shopName: true, phone: true, address: true, province: true, ownerId: true } },
      owner: { select: { id: true, fullName: true, phone: true } },
      quote: { select: { id: true, code: true } },
    },
  });
  if (!order || !authorize(actor, 'order.view', order)) throw notFound('đơn hàng');
  return order;
}

const PAYMENT_LABEL: Record<string, string> = { UNPAID: 'Chưa thanh toán', PARTIAL: 'Thanh toán một phần', PAID: 'Đã thanh toán' };
const DELIVERY_LABEL: Record<string, string> = { PENDING: 'Chờ xử lý', PACKING: 'Đang đóng gói', SHIPPING: 'Đang giao', DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy' };
const METHOD_LABEL: Record<string, string> = { BANK_TRANSFER: 'Chuyển khoản', CASH: 'Tiền mặt', CREDIT: 'Công nợ' };

/** Excel for the accounting / warehouse software (SPEC 6.7): one sheet of orders, one of lines. */
export async function exportOrders(ctx: ServiceContext, raw: z.input<typeof OrderListFilters>): Promise<Buffer> {
  assertAuthorized(actorOf(ctx), 'export.orders');
  const f = OrderListFilters.parse({ ...raw, limit: 5000 });
  const orders = await ctx.db.order.findMany({
    where: orderWhere(ctx, f),
    orderBy: { orderedAt: 'asc' },
    take: 5000,
    include: { customer: true, owner: { select: { fullName: true } }, items: { include: { product: { select: { sku: true, name: true, unit: true } } } } },
  });
  const ExcelJS = (await import('exceljs')).default; // loaded lazily, like the customer import
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Đơn hàng');
  sheet.columns = [
    { header: 'Mã đơn', key: 'code', width: 16 }, { header: 'Ngày đặt', key: 'orderedAt', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Khách', key: 'customer', width: 30 }, { header: 'SĐT', key: 'phone', width: 14 }, { header: 'Tỉnh/thành', key: 'province', width: 14 },
    { header: 'Sales', key: 'owner', width: 20 }, { header: 'Tiền hàng', key: 'subtotal', width: 14 }, { header: 'Chiết khấu', key: 'discount', width: 12 },
    { header: 'Phí vận chuyển', key: 'shippingFee', width: 14 }, { header: 'Tổng tiền', key: 'total', width: 14 }, { header: 'Thanh toán', key: 'payment', width: 20 },
    { header: 'Đã trả', key: 'paid', width: 14 }, { header: 'Phương thức', key: 'method', width: 14 }, { header: 'Giao hàng', key: 'delivery', width: 14 },
    { header: 'Mã vận đơn', key: 'tracking', width: 16 }, { header: 'Địa chỉ giao', key: 'address', width: 40 }, { header: 'Ghi chú', key: 'note', width: 30 },
  ];
  const lines = wb.addWorksheet('Dòng hàng');
  lines.columns = [
    { header: 'Mã đơn', key: 'code', width: 16 }, { header: 'SKU', key: 'sku', width: 16 }, { header: 'Sản phẩm', key: 'name', width: 40 }, { header: 'ĐVT', key: 'unit', width: 8 },
    { header: 'SL', key: 'qty', width: 8 }, { header: 'Đơn giá', key: 'unitPrice', width: 12 }, { header: 'Chiết khấu', key: 'discount', width: 12 }, { header: 'Thành tiền', key: 'lineTotal', width: 14 },
  ];
  // Excel has no time zone: write Vietnam wall-clock time.
  const vnTime = (d: Date) => new Date(d.getTime() + 7 * 3600_000);
  for (const o of orders) {
    sheet.addRow({
      code: o.code, orderedAt: vnTime(o.orderedAt), customer: o.customer.shopName ?? o.customer.contactName, phone: o.customer.phone?.replace(/^\+84/, '0') ?? '',
      province: o.customer.province ?? '', owner: o.owner.fullName, subtotal: Number(o.subtotal), discount: Number(o.discount), shippingFee: Number(o.shippingFee),
      total: Number(o.total), payment: PAYMENT_LABEL[o.paymentStatus], paid: Number(o.paidAmount), method: METHOD_LABEL[o.paymentMethod], delivery: DELIVERY_LABEL[o.deliveryStatus],
      tracking: o.trackingCode ?? '', address: o.shippingAddress ?? '', note: o.note ?? '',
    });
    for (const l of o.items) {
      lines.addRow({ code: o.code, sku: l.product.sku, name: l.product.name, unit: l.product.unit ?? '', qty: Number(l.qty), unitPrice: Number(l.unitPrice), discount: Number(l.discount), lineTotal: Number(l.lineTotal) });
    }
  }
  for (const s of [sheet, lines]) {
    s.getRow(1).font = { bold: true };
    s.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** "5 mặt hàng khách mua nhiều nhất" (SPEC 6.8, §8 /customers/:id/top-products) by quantity, non-cancelled orders. */
export async function topProducts(ctx: ServiceContext, customerId: string, limit = 5) {
  const actor = actorOf(ctx);
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, orgId: ctx.orgId, deletedAt: null } });
  if (!c || !authorize(actor, 'customer.view', c)) throw notFound('khách hàng');
  const rows = await ctx.db.orderItem.groupBy({
    by: ['productId'],
    where: { order: { customerId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' } } },
    _sum: { qty: true, lineTotal: true },
    _count: true,
    orderBy: { _sum: { qty: 'desc' } },
    take: limit,
  });
  const products = await ctx.db.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, sku: true, name: true, unit: true } });
  return rows.map((r) => ({ ...products.find((p) => p.id === r.productId)!, qty: Number(r._sum.qty ?? 0), revenue: Number(r._sum.lineTotal ?? 0), orders: r._count }));
}
