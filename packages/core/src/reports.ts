// Báo cáo (S12, SPEC 6.11, §8 /reports/*). Every report returns the same table shape so the UI renders
// it and `exportReport` writes it to Excel with the current filters. Metric formulas live in metrics.ts.
import { authorize } from '@michio/auth';
import type { LeadSource, Prisma } from '@michio/db';
import { BUSINESS_MODEL_LABELS, LEAD_SOURCE_LABELS, ORDER_BAND_LABELS, vnMonthRange } from '@michio/shared';
import { z } from 'zod';
import { businessMinutesBetween } from './business-time';
import { loadCalendar } from './calendar';
import type { ServiceContext } from './context';
import { DomainError } from './errors';
import { conversion, frtMinutes, median, onTimeAcceptance, percentile, ratio, retention, vnQuarterRange } from './metrics';

export const REPORT_NAMES = ['overview', 'sources', 'funnel', 'sales-comparison', 'revenue', 'customers', 'products', 'lost-reasons', 'sla'] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export const REPORT_TITLES: Record<ReportName, string> = {
  overview: 'Tổng quan',
  sources: 'Nguồn lead',
  funnel: 'Phễu',
  'sales-comparison': 'So sánh sales',
  revenue: 'Doanh số',
  customers: 'Khách hàng',
  products: 'Sản phẩm',
  'lost-reasons': 'Lý do thua',
  sla: 'Tốc độ phản hồi',
};

/** SUPPORT sees only order reports (§3 "Báo cáo: SUPPORT đơn hàng"). */
const ORDER_REPORTS = new Set<ReportName>(['revenue', 'products']);

const SOURCES = Object.keys(LEAD_SOURCE_LABELS) as [LeadSource, ...LeadSource[]];
export const ReportFilters = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ownerId: z.string().optional(),
  source: z.enum(SOURCES).optional(),
  businessModel: z.enum(['JAPAN_STORE', 'ONLINE_SHOP', 'MINIMART', 'RETAIL_AGENT', 'CAFE', 'DISTRIBUTOR', 'OTHER']).optional(),
  province: z.string().trim().max(80).optional(),
  /** revenue: day | week | month; funnel: source | businessModel | orderBand. */
  groupBy: z.string().max(20).optional(),
});
export type ReportFilters = z.input<typeof ReportFilters>;

export type ColumnType = 'text' | 'int' | 'money' | 'percent' | 'minutes';
export interface ReportTable {
  name: ReportName;
  title: string;
  period: { from: Date; to: Date };
  columns: { key: string; label: string; type: ColumnType }[];
  rows: Record<string, string | number | null>[];
  /** Headline numbers shown above the table (also exported). */
  summary: { label: string; value: number | null; type: ColumnType }[];
}

const DAY = 86_400_000;
const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10); // 0.3333 → 33.3

interface Scope {
  from: Date;
  to: Date;
  ownerId?: string;
  customer: Prisma.CustomerWhereInput;
  source?: LeadSource;
  groupBy?: string;
}

function scopeOf(ctx: ServiceContext, name: ReportName, raw: ReportFilters): Scope {
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const canAll = authorize(actor, 'report.view');
  const canOrders = authorize(actor, 'report.orders');
  if (!canAll && !(canOrders && ORDER_REPORTS.has(name))) throw new DomainError('VALIDATION_ERROR', 'Bạn không có quyền xem báo cáo này');
  const f = ReportFilters.parse(raw);
  const month = vnMonthRange(ctx.now());
  const from = f.from ?? month.start;
  const to = f.to ?? month.end;
  if (to <= from) throw new DomainError('VALIDATION_ERROR', 'Khoảng thời gian không hợp lệ');
  if (to.getTime() - from.getTime() > 731 * DAY) throw new DomainError('VALIDATION_ERROR', 'Tối đa 2 năm mỗi báo cáo');
  // SALES: "Báo cáo — bản thân" (§3) — always their own numbers, whatever the filter says.
  const own = actor.role === 'SALES';
  const customer: Prisma.CustomerWhereInput = {};
  if (f.businessModel) customer.businessModel = f.businessModel;
  if (f.province) customer.province = { contains: f.province, mode: 'insensitive' };
  return { from, to, ownerId: own ? actor.id : f.ownerId, customer, source: f.source, groupBy: f.groupBy };
}

const leadWhere = (ctx: ServiceContext, s: Scope, extra: Prisma.LeadWhereInput = {}): Prisma.LeadWhereInput => ({
  orgId: ctx.orgId, deletedAt: null, ...(s.ownerId ? { ownerId: s.ownerId } : {}), ...(s.source ? { source: s.source } : {}),
  ...(Object.keys(s.customer).length ? { customer: s.customer } : {}), ...extra,
});
const orderWhere = (ctx: ServiceContext, s: Scope, extra: Prisma.OrderWhereInput = {}): Prisma.OrderWhereInput => ({
  orgId: ctx.orgId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { gte: s.from, lt: s.to },
  ...(s.ownerId ? { ownerId: s.ownerId } : {}), ...(Object.keys(s.customer).length ? { customer: s.customer } : {}), ...extra,
});
const closedDealWhere = (ctx: ServiceContext, s: Scope): Prisma.DealWhereInput => ({
  orgId: ctx.orgId, deletedAt: null, closedAt: { gte: s.from, lt: s.to }, ...(s.ownerId ? { ownerId: s.ownerId } : {}),
  ...(Object.keys(s.customer).length ? { customer: s.customer } : {}), ...(s.source ? { lead: { source: s.source } } : {}),
});

async function salesUsers(ctx: ServiceContext, s: Scope) {
  return ctx.db.user.findMany({
    where: { orgId: ctx.orgId, deletedAt: null, role: { in: ['SALES', 'OWNER', 'MANAGER'] }, ...(s.ownerId ? { id: s.ownerId } : { OR: [{ role: 'SALES' }, { ownedOrders: { some: {} } }] }) },
    select: { id: true, fullName: true, role: true, status: true },
    orderBy: { fullName: 'asc' },
  });
}

/** Leads created in the period → how far they got (cohort funnel, 6.11 "Phễu"). */
async function leadCohort(ctx: ServiceContext, s: Scope) {
  const leads = await ctx.db.lead.findMany({
    where: leadWhere(ctx, s, { createdAt: { gte: s.from, lt: s.to } }),
    select: {
      id: true, source: true, status: true, firstContactAt: true, firstAssignedAt: true, ownerId: true,
      customer: { select: { businessModel: true, expectedOrderBand: true } },
      deals: { select: { stage: { select: { order: true, code: true, isWon: true, isLost: true } }, quotes: { where: { sentAt: { not: null } }, select: { id: true } } } },
    },
  });
  const quoteStage = await ctx.db.pipelineStage.findFirst({ where: { orgId: ctx.orgId, code: 'BAO_GIA' }, select: { order: true } });
  return leads.map((l) => {
    const won = l.status === 'WON' || l.deals.some((d) => d.stage.isWon);
    const lost = !won && (l.status === 'LOST' || l.deals.some((d) => d.stage.isLost));
    const quoted = won || l.deals.some((d) => d.quotes.length > 0 || (quoteStage && d.stage.order >= quoteStage.order && !d.stage.isLost));
    return { ...l, contacted: Boolean(l.firstContactAt) || quoted || won, quoted, won, lost };
  });
}

const money = (key: string, label: string) => ({ key, label, type: 'money' as const });
const int = (key: string, label: string) => ({ key, label, type: 'int' as const });
const percent = (key: string, label: string) => ({ key, label, type: 'percent' as const });
const text = (key: string, label: string) => ({ key, label, type: 'text' as const });
const minutes = (key: string, label: string) => ({ key, label, type: 'minutes' as const });

export async function getReport(ctx: ServiceContext, name: ReportName, raw: ReportFilters = {}): Promise<ReportTable> {
  if (!REPORT_NAMES.includes(name)) throw new DomainError('NOT_FOUND', 'Không có báo cáo này');
  const s = scopeOf(ctx, name, raw);
  const base = { name, title: REPORT_TITLES[name], period: { from: s.from, to: s.to } };
  switch (name) {
    case 'overview':
      return { ...base, ...(await overview(ctx, s)) };
    case 'sources':
    case 'funnel':
      return { ...base, ...(await funnel(ctx, s, name === 'sources' ? 'source' : (s.groupBy ?? 'source'))) };
    case 'sales-comparison':
      return { ...base, ...(await salesComparison(ctx, s)) };
    case 'revenue':
      return { ...base, ...(await revenueReport(ctx, s)) };
    case 'customers':
      return { ...base, ...(await customersReport(ctx, s)) };
    case 'products':
      return { ...base, ...(await productsReport(ctx, s)) };
    case 'lost-reasons':
      return { ...base, ...(await lostReasons(ctx, s)) };
    case 'sla':
      return { ...base, ...(await slaReport(ctx, s)) };
  }
}

// ---------- individual reports ----------

async function overview(ctx: ServiceContext, s: Scope) {
  const cal = await loadCalendar(ctx.db, ctx.orgId);
  const now = ctx.now();
  const [cohort, contacted, deals, orders, waiting, overdueAccept, overdueContact, atRisk, dormant, expired, targets] = await Promise.all([
    leadCohort(ctx, s),
    ctx.db.lead.findMany({ where: leadWhere(ctx, s, { firstContactAt: { gte: s.from, lt: s.to } }), select: { firstAssignedAt: true, firstContactAt: true } }),
    ctx.db.deal.findMany({ where: closedDealWhere(ctx, s), select: { stage: { select: { isWon: true, isLost: true } } } }),
    ctx.db.order.findMany({ where: orderWhere(ctx, s), select: { total: true, customerId: true, orderedAt: true, customer: { select: { firstOrderAt: true } } } }),
    ctx.db.lead.count({ where: leadWhere(ctx, s, { status: 'ASSIGNED' }) }),
    ctx.db.leadAssignment.count({ where: { status: 'PENDING', acceptDeadline: { lt: now }, lead: leadWhere(ctx, s) } }),
    ctx.db.lead.count({ where: leadWhere(ctx, s, { status: 'IN_PROGRESS', firstContactAt: null, firstContactDeadline: { lt: now } }) }),
    ctx.db.customer.count({ where: { orgId: ctx.orgId, deletedAt: null, lifecycle: 'AT_RISK', ...(s.ownerId ? { ownerId: s.ownerId } : {}), ...s.customer } }),
    ctx.db.customer.count({ where: { orgId: ctx.orgId, deletedAt: null, lifecycle: 'DORMANT', ...(s.ownerId ? { ownerId: s.ownerId } : {}), ...s.customer } }),
    ctx.db.leadAssignment.count({ where: { status: 'EXPIRED', createdAt: { gte: s.from, lt: s.to }, lead: leadWhere(ctx, s) } }),
    ctx.db.target.findMany({ where: { orgId: ctx.orgId, month: vnMonthRange(s.from).key, ...(s.ownerId ? { userId: s.ownerId } : {}) } }),
  ]);
  const frt = frtMinutes(contacted, cal);
  const conv = conversion(deals.map((d) => d.stage));
  const rev = orders.reduce((x, o) => x + Number(o.total), 0);
  const isNew = (o: (typeof orders)[number]) => o.customer.firstOrderAt && o.customer.firstOrderAt.getTime() === o.orderedAt.getTime();
  const revNew = orders.filter(isNew).reduce((x, o) => x + Number(o.total), 0);
  const target = targets.reduce((x, t) => x + Number(t.revenue), 0);
  const bySource = new Map<string, number>();
  for (const l of cohort) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
  return {
    summary: [
      { label: 'Lead mới', value: cohort.length, type: 'int' as const },
      { label: 'Lead chờ nhận', value: waiting, type: 'int' as const },
      { label: 'Quá hạn nhận', value: overdueAccept, type: 'int' as const },
      { label: 'Quá hạn liên hệ', value: overdueContact, type: 'int' as const },
      { label: 'FRT trung vị (phút)', value: median(frt), type: 'minutes' as const },
      { label: 'FRT P90 (phút)', value: percentile(frt, 90), type: 'minutes' as const },
      { label: 'Lần thu hồi', value: expired, type: 'int' as const },
      { label: 'Tỷ lệ chốt', value: pct(conv.rate), type: 'percent' as const },
      { label: 'Doanh số', value: rev, type: 'money' as const },
      { label: 'Số đơn', value: orders.length, type: 'int' as const },
      { label: 'Giá trị đơn TB', value: orders.length ? Math.round(rev / orders.length) : null, type: 'money' as const },
      { label: 'Doanh số khách mới', value: revNew, type: 'money' as const },
      { label: 'Doanh số khách cũ', value: rev - revNew, type: 'money' as const },
      { label: '% chỉ tiêu tháng', value: target ? pct(rev / target) : null, type: 'percent' as const },
      { label: 'Khách có nguy cơ', value: atRisk, type: 'int' as const },
      { label: 'Khách ngủ đông', value: dormant, type: 'int' as const },
    ],
    columns: [text('source', 'Nguồn'), int('leads', 'Lead mới')],
    rows: [...bySource].sort((a, b) => b[1] - a[1]).map(([src, n]) => ({ source: LEAD_SOURCE_LABELS[src as LeadSource] ?? src, leads: n })),
  };
}

async function funnel(ctx: ServiceContext, s: Scope, by: string) {
  const cohort = await leadCohort(ctx, s);
  const keyOf = (l: (typeof cohort)[number]) =>
    by === 'businessModel'
      ? (l.customer.businessModel ? BUSINESS_MODEL_LABELS[l.customer.businessModel] : 'Chưa rõ')
      : by === 'orderBand'
        ? ORDER_BAND_LABELS[l.customer.expectedOrderBand ?? 'UNKNOWN']
        : LEAD_SOURCE_LABELS[l.source];
  const groups = new Map<string, typeof cohort>();
  for (const l of cohort) groups.set(keyOf(l), [...(groups.get(keyOf(l)) ?? []), l]);
  const row = (label: string, ls: typeof cohort) => {
    const won = ls.filter((l) => l.won).length;
    const lost = ls.filter((l) => l.lost).length;
    return { group: label, leads: ls.length, contacted: ls.filter((l) => l.contacted).length, quoted: ls.filter((l) => l.quoted).length, won, lost, rate: pct(ratio(won, won + lost)) };
  };
  const total = row('Tổng', cohort);
  return {
    summary: [
      { label: 'Lead', value: total.leads, type: 'int' as const },
      { label: 'Đã liên hệ', value: total.contacted, type: 'int' as const },
      { label: 'Đã báo giá', value: total.quoted, type: 'int' as const },
      { label: 'Chốt', value: total.won, type: 'int' as const },
      { label: 'Tỷ lệ chốt', value: total.rate, type: 'percent' as const },
    ],
    columns: [text('group', by === 'businessModel' ? 'Mô hình kinh doanh' : by === 'orderBand' ? 'Mức nhập' : 'Nguồn'), int('leads', 'Lead'), int('contacted', 'Đã liên hệ'), int('quoted', 'Báo giá'), int('won', 'Chốt'), int('lost', 'Thua'), percent('rate', 'Tỷ lệ chốt %')],
    rows: [...[...groups].sort((a, b) => b[1].length - a[1].length).map(([k, ls]) => row(k, ls)), total],
  };
}

async function salesComparison(ctx: ServiceContext, s: Scope) {
  const cal = await loadCalendar(ctx.db, ctx.orgId);
  const users = await salesUsers(ctx, s);
  const ids = users.map((u) => u.id);
  const [assignments, contacted, activities, quotes, orders, deals, targets, firstOrders] = await Promise.all([
    ctx.db.leadAssignment.groupBy({ by: ['userId'], where: { userId: { in: ids }, createdAt: { gte: s.from, lt: s.to }, lead: leadWhere(ctx, { ...s, ownerId: undefined }) }, _count: true }),
    ctx.db.lead.findMany({ where: leadWhere(ctx, { ...s, ownerId: undefined }, { ownerId: { in: ids }, firstContactAt: { gte: s.from, lt: s.to } }), select: { ownerId: true, firstAssignedAt: true, firstContactAt: true } }),
    ctx.db.activity.groupBy({ by: ['userId'], where: { orgId: ctx.orgId, userId: { in: ids }, createdAt: { gte: s.from, lt: s.to }, type: { in: ['CALL', 'MEETING', 'NOTE', 'MESSAGE_OUT'] } }, _count: true }),
    ctx.db.quote.groupBy({ by: ['ownerId'], where: { orgId: ctx.orgId, ownerId: { in: ids }, sentAt: { gte: s.from, lt: s.to }, ...(Object.keys(s.customer).length ? { customer: s.customer } : {}) }, _count: true }),
    ctx.db.order.groupBy({ by: ['ownerId'], where: orderWhere(ctx, { ...s, ownerId: undefined }, { ownerId: { in: ids } }), _count: true, _sum: { total: true } }),
    ctx.db.deal.findMany({ where: { ...closedDealWhere(ctx, { ...s, ownerId: undefined }), ownerId: { in: ids } }, select: { ownerId: true, stage: { select: { isWon: true, isLost: true } } } }),
    ctx.db.target.findMany({ where: { orgId: ctx.orgId, userId: { in: ids }, month: vnMonthRange(s.from).key } }),
    ctx.db.customer.groupBy({ by: ['ownerId'], where: { orgId: ctx.orgId, deletedAt: null, ownerId: { in: ids }, firstOrderAt: { gte: s.from, lt: s.to }, ...s.customer }, _count: true }),
  ]);
  const rows = users.map((u) => {
    const frt = frtMinutes(contacted.filter((l) => l.ownerId === u.id), cal);
    const o = orders.find((x) => x.ownerId === u.id);
    const rev = Number(o?._sum.total ?? 0);
    const t = targets.find((x) => x.userId === u.id);
    return {
      sales: u.fullName,
      leads: assignments.find((x) => x.userId === u.id)?._count ?? 0,
      frtMedian: median(frt),
      activities: activities.find((x) => x.userId === u.id)?._count ?? 0,
      quotes: quotes.find((x) => x.ownerId === u.id)?._count ?? 0,
      orders: o?._count ?? 0,
      revenue: rev,
      newCustomers: firstOrders.find((x) => x.ownerId === u.id)?._count ?? 0,
      rate: pct(conversion(deals.filter((d) => d.ownerId === u.id).map((d) => d.stage)).rate),
      target: t ? Number(t.revenue) : null,
      targetPct: t && Number(t.revenue) ? pct(rev / Number(t.revenue)) : null,
    };
  });
  return {
    summary: [
      { label: 'Doanh số', value: rows.reduce((x, r) => x + r.revenue, 0), type: 'money' as const },
      { label: 'Đơn', value: rows.reduce((x, r) => x + r.orders, 0), type: 'int' as const },
    ],
    columns: [
      text('sales', 'Sales'), int('leads', 'Lead nhận'), minutes('frtMedian', 'FRT trung vị'), int('activities', 'Hoạt động'), int('quotes', 'Báo giá gửi'),
      int('orders', 'Đơn'), money('revenue', 'Doanh số'), int('newCustomers', 'Khách mới'), percent('rate', 'Tỷ lệ chốt %'), money('target', 'Chỉ tiêu'), percent('targetPct', '% chỉ tiêu'),
    ],
    rows,
  };
}

function bucketKey(d: Date, groupBy: string) {
  const local = new Date(d.getTime() + 7 * 3600_000);
  if (groupBy === 'month') return local.toISOString().slice(0, 7);
  if (groupBy === 'week') {
    // ISO week starting Monday, labelled by its Monday.
    const dow = (local.getUTCDay() + 6) % 7;
    return new Date(local.getTime() - dow * DAY).toISOString().slice(0, 10);
  }
  return local.toISOString().slice(0, 10);
}

async function revenueReport(ctx: ServiceContext, s: Scope) {
  const groupBy = s.groupBy === 'week' || s.groupBy === 'month' ? s.groupBy : s.to.getTime() - s.from.getTime() > 62 * DAY ? 'month' : 'day';
  const orders = await ctx.db.order.findMany({ where: orderWhere(ctx, s), select: { total: true, orderedAt: true, customer: { select: { firstOrderAt: true } } }, orderBy: { orderedAt: 'asc' } });
  const map = new Map<string, { period: string; orders: number; revenue: number; revenueNew: number; revenueReturning: number }>();
  // Every bucket in the period, so charts have no gaps.
  for (let t = s.from.getTime(); t < s.to.getTime(); t += DAY) {
    const k = bucketKey(new Date(t), groupBy);
    if (!map.has(k)) map.set(k, { period: k, orders: 0, revenue: 0, revenueNew: 0, revenueReturning: 0 });
  }
  for (const o of orders) {
    const r = map.get(bucketKey(o.orderedAt, groupBy))!;
    const total = Number(o.total);
    const first = o.customer.firstOrderAt?.getTime() === o.orderedAt.getTime();
    r.orders++;
    r.revenue += total;
    if (first) r.revenueNew += total;
    else r.revenueReturning += total;
  }
  const rev = orders.reduce((x, o) => x + Number(o.total), 0);
  return {
    summary: [
      { label: 'Doanh số', value: rev, type: 'money' as const },
      { label: 'Số đơn', value: orders.length, type: 'int' as const },
      { label: 'Giá trị đơn TB', value: orders.length ? Math.round(rev / orders.length) : null, type: 'money' as const },
    ],
    columns: [text('period', groupBy === 'month' ? 'Tháng' : groupBy === 'week' ? 'Tuần (từ thứ Hai)' : 'Ngày'), int('orders', 'Đơn'), money('revenue', 'Doanh số'), money('revenueNew', 'Khách mới'), money('revenueReturning', 'Khách cũ')],
    rows: [...map.values()],
  };
}

async function customersReport(ctx: ServiceContext, s: Scope) {
  const owner = s.ownerId ? { ownerId: s.ownerId } : {};
  const [orders, lifecycles] = await Promise.all([
    ctx.db.order.findMany({ where: { orgId: ctx.orgId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { lt: s.to }, ...owner, ...(Object.keys(s.customer).length ? { customer: s.customer } : {}) }, select: { customerId: true, orderedAt: true } }),
    ctx.db.customer.groupBy({ by: ['lifecycle'], where: { orgId: ctx.orgId, deletedAt: null, ...owner, ...s.customer }, _count: true }),
  ]);
  const first = new Map<string, Date>();
  for (const o of orders) if (!first.has(o.customerId) || o.orderedAt < first.get(o.customerId)!) first.set(o.customerId, o.orderedAt);
  const months = new Map<string, { month: string; newCustomers: number; activeCustomers: Set<string> }>();
  for (let t = s.from.getTime(); t < s.to.getTime(); t += DAY) {
    const k = bucketKey(new Date(t), 'month');
    if (!months.has(k)) months.set(k, { month: k, newCustomers: 0, activeCustomers: new Set() });
  }
  for (const o of orders) {
    if (o.orderedAt < s.from) continue;
    const m = months.get(bucketKey(o.orderedAt, 'month'));
    m?.activeCustomers.add(o.customerId);
  }
  for (const [, d] of first) if (d >= s.from && d < s.to) months.get(bucketKey(d, 'month'))!.newCustomers++;
  const q = vnQuarterRange(new Date(s.to.getTime() - 1));
  const ret = retention(orders, q);
  const lc = (k: string) => lifecycles.find((x) => x.lifecycle === k)?._count ?? 0;
  return {
    summary: [
      { label: 'Khách mới trong kỳ', value: [...months.values()].reduce((x, m) => x + m.newCustomers, 0), type: 'int' as const },
      { label: `Tỷ lệ quay lại ${q.key}`, value: pct(ret.rate), type: 'percent' as const },
      { label: 'Khách quay lại / cơ sở', value: ret.returned, type: 'int' as const },
      { label: 'Khách mua lặp lại', value: lc('REPEAT'), type: 'int' as const },
      { label: 'Có nguy cơ (AT_RISK)', value: lc('AT_RISK'), type: 'int' as const },
      { label: 'Ngủ đông (DORMANT)', value: lc('DORMANT'), type: 'int' as const },
    ],
    columns: [text('month', 'Tháng'), int('newCustomers', 'Khách mới'), int('activeCustomers', 'Khách có đơn')],
    rows: [...months.values()].map((m) => ({ month: m.month, newCustomers: m.newCustomers, activeCustomers: m.activeCustomers.size })),
  };
}

async function productsReport(ctx: ServiceContext, s: Scope) {
  const items = await ctx.db.orderItem.groupBy({
    by: ['productId'],
    where: { order: orderWhere(ctx, s) },
    _sum: { lineTotal: true, qty: true },
    _count: true,
    orderBy: { _sum: { lineTotal: 'desc' } },
  });
  const products = await ctx.db.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, select: { id: true, sku: true, name: true, categoryIds: true } });
  const cats = await ctx.db.productCategory.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } });
  const total = items.reduce((x, i) => x + Number(i._sum.lineTotal ?? 0), 0);
  const rows = items.map((i) => {
    const p = products.find((x) => x.id === i.productId);
    const revenue = Number(i._sum.lineTotal ?? 0);
    return {
      sku: p?.sku ?? '', name: p?.name ?? '', category: p?.categoryIds.map((c) => cats.find((x) => x.id === c)?.name).filter(Boolean).join(', ') ?? '',
      qty: Number(i._sum.qty ?? 0), orders: i._count, revenue, share: pct(ratio(revenue, total)),
    };
  });
  return {
    summary: [{ label: 'Doanh số hàng', value: total, type: 'money' as const }, { label: 'Mã hàng bán được', value: rows.length, type: 'int' as const }],
    columns: [text('sku', 'SKU'), text('name', 'Sản phẩm'), text('category', 'Nhóm hàng'), int('qty', 'SL'), int('orders', 'Số dòng đơn'), money('revenue', 'Doanh số'), percent('share', '% doanh số')],
    rows,
  };
}

async function lostReasons(ctx: ServiceContext, s: Scope) {
  const deals = await ctx.db.deal.findMany({ where: { ...closedDealWhere(ctx, s), stage: { isLost: true } }, select: { lostReason: { select: { name: true } } } });
  const counts = new Map<string, number>();
  for (const d of deals) counts.set(d.lostReason?.name ?? 'Không ghi lý do', (counts.get(d.lostReason?.name ?? 'Không ghi lý do') ?? 0) + 1);
  return {
    summary: [{ label: 'Cơ hội thua', value: deals.length, type: 'int' as const }],
    columns: [text('reason', 'Lý do'), int('count', 'Số cơ hội'), percent('share', '%')],
    rows: [...counts].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count, share: pct(ratio(count, deals.length)) })),
  };
}

async function slaReport(ctx: ServiceContext, s: Scope) {
  const cal = await loadCalendar(ctx.db, ctx.orgId);
  const users = await salesUsers(ctx, s);
  const ids = users.map((u) => u.id);
  const now = ctx.now();
  const [assignments, contacted, overdue] = await Promise.all([
    ctx.db.leadAssignment.findMany({ where: { userId: { in: ids }, createdAt: { gte: s.from, lt: s.to }, lead: leadWhere(ctx, { ...s, ownerId: undefined }) }, select: { userId: true, method: true, status: true, respondedAt: true, acceptDeadline: true, createdAt: true } }),
    ctx.db.lead.findMany({ where: leadWhere(ctx, { ...s, ownerId: undefined }, { ownerId: { in: ids }, firstContactAt: { gte: s.from, lt: s.to } }), select: { ownerId: true, firstAssignedAt: true, firstContactAt: true } }),
    ctx.db.lead.groupBy({ by: ['ownerId'], where: leadWhere(ctx, { ...s, ownerId: undefined }, { ownerId: { in: ids }, status: 'IN_PROGRESS', firstContactAt: null, firstContactDeadline: { lt: now } }), _count: true }),
  ]);
  const all = frtMinutes(contacted, cal);
  const rows = users.map((u) => {
    const mine = assignments.filter((a) => a.userId === u.id);
    const acc = onTimeAcceptance(mine, now);
    const accepted = mine.filter((a) => a.respondedAt && a.acceptDeadline && a.status !== 'RETURNED');
    const frt = frtMinutes(contacted.filter((l) => l.ownerId === u.id), cal);
    return {
      sales: u.fullName,
      assignments: mine.length,
      onTimeRate: pct(acc.rate),
      acceptMedian: median(accepted.map((a) => businessMinutesBetween(a.createdAt, a.respondedAt!, cal))),
      expired: mine.filter((a) => a.status === 'EXPIRED').length,
      returned: mine.filter((a) => a.status === 'RETURNED').length,
      frtMedian: median(frt),
      frtP90: percentile(frt, 90),
      contactOverdue: overdue.find((x) => x.ownerId === u.id)?._count ?? 0,
    };
  });
  const allAcc = onTimeAcceptance(assignments, now);
  return {
    summary: [
      { label: 'FRT trung vị (phút)', value: median(all), type: 'minutes' as const },
      { label: 'FRT P90 (phút)', value: percentile(all, 90), type: 'minutes' as const },
      { label: 'Nhận đúng hạn', value: pct(allAcc.rate), type: 'percent' as const },
      { label: 'Thu hồi do quá hạn', value: assignments.filter((a) => a.status === 'EXPIRED').length, type: 'int' as const },
    ],
    columns: [
      text('sales', 'Sales'), int('assignments', 'Lượt giao'), percent('onTimeRate', 'Nhận đúng hạn %'), minutes('acceptMedian', 'Thời gian nhận (TV)'),
      int('expired', 'Bị thu hồi'), int('returned', 'Tự trả'), minutes('frtMedian', 'FRT trung vị'), minutes('frtP90', 'FRT P90'), int('contactOverdue', 'Quá hạn liên hệ'),
    ],
    rows,
  };
}

// ---------- export ----------

/** GET /reports/:name/export — the same table as on screen, with filters and period in the header. */
export async function exportReport(ctx: ServiceContext, name: ReportName, raw: ReportFilters = {}): Promise<{ fileName: string; buffer: Buffer }> {
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const canExport = authorize(actor, 'export.reports') || (ORDER_REPORTS.has(name) && authorize(actor, 'export.orders'));
  if (!canExport) throw new DomainError('VALIDATION_ERROR', 'Bạn không có quyền xuất Excel báo cáo');
  const r = await getReport(ctx, name, raw);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  const day = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
  ws.addRow([`Báo cáo ${r.title}`]).font = { bold: true, size: 14 };
  ws.addRow([`Từ ${day(r.period.from)} đến hết ${day(new Date(r.period.to.getTime() - 1))}`]);
  for (const s of r.summary) ws.addRow([s.label, s.value]);
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => row[c.key] ?? ''));
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.type === 'text' ? 32 : 16;
    if (c.type === 'money') col.numFmt = '#,##0';
  });
  const stamp = new Date(ctx.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  return { fileName: `bao-cao-${name}-${stamp}.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}
