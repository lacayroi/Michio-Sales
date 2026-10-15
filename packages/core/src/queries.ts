// Read models for the M1 screens (S2, S4, S5, S15, S16). Every list goes through scopeFilter (SPEC §3).
import { assertAuthorized, authorize, scopeFilter } from '@michio/auth';
import type { LeadSource, LeadStatus, Prisma, Priority } from '@michio/db';
import { normalizeVnPhone, vnDayRange, vnMonthRange } from '@michio/shared';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { DomainError, notFound } from './errors';

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess((v) => (typeof v === 'string' && v ? v.split(',') : v), z.array(z.enum(values)).optional());

export const LeadListFilters = z.object({
  status: csv(['NEW', 'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'WON', 'LOST']),
  ownerId: z.string().optional(), // "none" = unassigned
  source: csv([
    'WEBSITE_WHOLESALE_FORM', 'WEBSITE_AGENT_FORM', 'FACEBOOK_MESSENGER', 'FACEBOOK_LEAD_ADS', 'ZALO_COMPANY', 'ZALO_OA', 'HOTLINE', 'REFERRAL', 'IMPORT', 'MANUAL', 'OTHER',
  ]),
  priority: csv(['HOT', 'WARM', 'COLD']),
  businessModel: csv(['JAPAN_STORE', 'ONLINE_SHOP', 'MINIMART', 'RETAIL_AGENT', 'CAFE', 'DISTRIBUTOR', 'OTHER']),
  province: z.string().max(80).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  slaBreached: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type LeadListFilters = z.input<typeof LeadListFilters>;

/** Free-text search: name, shop, phone (any format), email, lead code. */
function customerSearch(q: string): Prisma.CustomerWhereInput {
  const phone = normalizeVnPhone(q);
  const digits = q.replace(/\D/g, '');
  return {
    OR: [
      { contactName: { contains: q, mode: 'insensitive' } },
      { shopName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      ...(phone ? [{ phone }] : digits.length >= 4 ? [{ phone: { contains: digits.replace(/^0/, '') } }] : []),
    ],
  };
}

export async function listLeads(ctx: ServiceContext, raw: LeadListFilters) {
  const actor = actorOf(ctx);
  const f = LeadListFilters.parse(raw);
  const now = ctx.now();
  const where: Prisma.LeadWhereInput = { ...scopeFilter(actor, 'lead'), deletedAt: null };
  const and: Prisma.LeadWhereInput[] = [];
  if (f.status?.length) where.status = { in: f.status as LeadStatus[] };
  if (f.ownerId) where.ownerId = f.ownerId === 'none' ? null : f.ownerId;
  if (f.source?.length) where.source = { in: f.source as LeadSource[] };
  if (f.priority?.length) where.priority = { in: f.priority as Priority[] };
  if (f.from || f.to) where.createdAt = { gte: f.from, lt: f.to };
  const customer: Prisma.CustomerWhereInput = {};
  if (f.businessModel?.length) customer.businessModel = { in: f.businessModel as never };
  if (f.province) customer.province = { contains: f.province, mode: 'insensitive' };
  if (f.q) {
    const code = /^#?\d{3,9}$/.test(f.q) ? Number(f.q.replace('#', '')) : null;
    and.push({ OR: [{ customer: customerSearch(f.q) }, ...(code ? [{ code }] : [])] });
  }
  if (Object.keys(customer).length) where.customer = customer;
  if (f.slaBreached) {
    and.push({
      OR: [
        { assignments: { some: { status: 'PENDING', acceptDeadline: { lt: now } } } },
        { status: 'IN_PROGRESS', firstContactAt: null, firstContactDeadline: { lt: now } },
        { status: 'UNASSIGNED' },
      ],
    });
  }
  if (and.length) where.AND = and;

  const rows = await ctx.db.lead.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: {
      customer: { select: { id: true, contactName: true, shopName: true, phone: true, province: true, businessModel: true, expectedOrderBand: true } },
      owner: { select: { id: true, fullName: true } },
      assignments: { where: { status: 'PENDING' }, select: { id: true, userId: true, acceptDeadline: true }, take: 1 },
    },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

export async function getLeadDetail(ctx: ServiceContext, leadId: string) {
  const actor = actorOf(ctx);
  const lead = await ctx.db.lead.findFirst({
    where: { id: leadId, orgId: ctx.orgId, deletedAt: null },
    include: {
      customer: { include: { owner: { select: { id: true, fullName: true } }, identities: { include: { channelAccount: { select: { type: true, name: true } } } } } },
      owner: { select: { id: true, fullName: true, phone: true } },
      assignments: {
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, fullName: true } }, rule: { select: { name: true, firstContactSlaMinutes: true } } },
      },
    },
  });
  if (!lead) throw notFound('lead');
  // OWN scope also lets the person a lead is currently offered to see it.
  const pendingForMe = lead.assignments.some((a) => a.status === 'PENDING' && a.userId === actor.id);
  if (!authorize(actor, 'lead.view', lead) && !pendingForMe) throw notFound('lead');
  return lead;
}

const ACTIVITY_LIMIT = 200;

export async function getTimeline(ctx: ServiceContext, opts: { leadId?: string; customerId?: string }) {
  // Visibility is enforced by loading the parent record first.
  if (opts.leadId) await getLeadDetail(ctx, opts.leadId);
  if (opts.customerId) await getCustomerDetail(ctx, opts.customerId);
  const where: Prisma.ActivityWhereInput = { orgId: ctx.orgId, ...(opts.leadId ? { leadId: opts.leadId } : { customerId: opts.customerId }) };
  const items = await ctx.db.activity.findMany({ where, orderBy: { createdAt: 'desc' }, take: ACTIVITY_LIMIT });
  const userIds = [...new Set(items.flatMap((a) => [a.userId, (a.data as Record<string, unknown>)?.toUserId, (a.data as Record<string, unknown>)?.fromUserId]).filter(Boolean) as string[])];
  const users = await ctx.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
  return { items, users: Object.fromEntries(users.map((u) => [u.id, u.fullName])) };
}

export const CustomerListFilters = z.object({
  q: z.string().trim().max(100).optional(),
  ownerId: z.string().optional(),
  lifecycle: csv(['PROSPECT', 'NEW_CUSTOMER', 'REPEAT', 'AT_RISK', 'DORMANT']),
  province: z.string().max(80).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function listCustomers(ctx: ServiceContext, raw: z.input<typeof CustomerListFilters>) {
  const actor = actorOf(ctx);
  const f = CustomerListFilters.parse(raw);
  const where: Prisma.CustomerWhereInput = { ...scopeFilter(actor, 'customer'), deletedAt: null };
  if (f.q) where.AND = [customerSearch(f.q)];
  if (f.ownerId) where.ownerId = f.ownerId === 'none' ? null : f.ownerId;
  if (f.lifecycle?.length) where.lifecycle = { in: f.lifecycle as never };
  if (f.province) where.province = { contains: f.province, mode: 'insensitive' };
  const rows = await ctx.db.customer.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { owner: { select: { id: true, fullName: true } } },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

export async function getCustomerDetail(ctx: ServiceContext, customerId: string) {
  const actor = actorOf(ctx);
  const c = await ctx.db.customer.findFirst({
    where: { id: customerId, orgId: ctx.orgId, deletedAt: null },
    include: {
      owner: { select: { id: true, fullName: true, phone: true } },
      priceList: { select: { name: true } },
      identities: { include: { channelAccount: { select: { type: true, name: true } } } },
      leads: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, include: { owner: { select: { fullName: true } } } },
    },
  });
  if (!c) throw notFound('khách hàng');
  // A salesperson may open a customer whose lead they are currently being offered.
  const offered = !authorize(actor, 'customer.view', c)
    ? await ctx.db.leadAssignment.count({ where: { userId: actor.id, status: 'PENDING', lead: { customerId } } })
    : 1;
  if (!offered) throw notFound('khách hàng');
  return c;
}

/** S2 — Trang chủ Sales. */
export async function salesHome(ctx: ServiceContext) {
  const actor = actorOf(ctx);
  const now = ctx.now();
  const today = vnDayRange(now);
  const month = vnMonthRange(now);
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const [pending, tasks, reorder, revenue, target, newLeads] = await Promise.all([
    ctx.db.leadAssignment.findMany({
      where: { userId: actor.id, status: 'PENDING', lead: { deletedAt: null } },
      orderBy: { acceptDeadline: 'asc' },
      include: { lead: { include: { customer: { select: { contactName: true, shopName: true, province: true, phone: true, businessModel: true, expectedOrderBand: true, interestCategories: true } } } } },
    }),
    ctx.db.task.findMany({
      where: { ...scopeFilter(actor, 'task'), status: 'TODO', dueAt: { lt: today.end } },
      orderBy: { dueAt: 'asc' },
      take: 20,
      include: { customer: { select: { id: true, contactName: true, shopName: true } } },
    }),
    ctx.db.customer.findMany({
      where: { ...scopeFilter(actor, 'customer'), deletedAt: null, orderCount: { gt: 0 }, OR: [{ nextReorderAt: { lte: soon } }, { lifecycle: 'AT_RISK' }] },
      orderBy: { nextReorderAt: 'asc' },
      take: 10,
      select: { id: true, contactName: true, shopName: true, province: true, nextReorderAt: true, lastOrderAt: true, lifecycle: true },
    }),
    ctx.db.order.aggregate({
      _sum: { total: true },
      where: { ...scopeFilter(actor, 'order'), deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { gte: month.start, lt: month.end } },
    }),
    ctx.db.target.findUnique({ where: { userId_month: { userId: actor.id, month: month.key } } }),
    ctx.db.lead.findMany({
      where: { ...scopeFilter(actor, 'lead'), deletedAt: null, status: 'IN_PROGRESS', firstContactAt: null },
      orderBy: { firstContactDeadline: 'asc' },
      take: 10,
      include: { customer: { select: { contactName: true, shopName: true, phone: true } } },
    }),
  ]);
  return { pending, tasks, reorder, revenue: Number(revenue._sum.total ?? 0), target: target ? Number(target.revenue) : null, toContact: newLeads };
}

/** S3 (M1 part) — what Owner/Manager need now: queue, overdue, today's leads by source, holiday reminder. */
export async function managerHome(ctx: ServiceContext) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'lead.view');
  const now = ctx.now();
  const today = vnDayRange(now);
  const month = vnMonthRange(now);
  const base = { ...scopeFilter(actor, 'lead'), deletedAt: null };
  const [queued, overdueAccept, overdueContact, bySource, revenue, confirmed, holidaysThisYear] = await Promise.all([
    ctx.db.lead.findMany({ where: { ...base, status: 'UNASSIGNED' }, orderBy: { createdAt: 'asc' }, take: 20, include: { customer: { select: { contactName: true, shopName: true } } } }),
    ctx.db.leadAssignment.count({ where: { status: 'PENDING', acceptDeadline: { lt: now }, lead: base } }),
    ctx.db.lead.count({ where: { ...base, status: 'IN_PROGRESS', firstContactAt: null, firstContactDeadline: { lt: now } } }),
    ctx.db.lead.groupBy({ by: ['source'], where: { ...base, createdAt: { gte: today.start, lt: today.end } }, _count: true }),
    ctx.db.order.aggregate({ _sum: { total: true }, _count: true, where: { orgId: ctx.orgId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { gte: month.start, lt: month.end } } }),
    ctx.db.setting.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: 'calendar.holidaysConfirmedYears' } } }),
    ctx.db.holiday.count({ where: { orgId: ctx.orgId, date: { gte: new Date(`${month.key.slice(0, 4)}-01-01T00:00:00Z`), lt: new Date(`${Number(month.key.slice(0, 4)) + 1}-01-01T00:00:00Z`) } } }),
  ]);
  const year = Number(month.key.slice(0, 4));
  const confirmedYears = (confirmed?.value as number[] | undefined) ?? [];
  return {
    queued,
    overdueAccept,
    overdueContact,
    bySource: bySource.map((s) => ({ source: s.source, count: s._count })),
    revenue: Number(revenue._sum.total ?? 0),
    orders: revenue._count,
    holidayReminder: confirmedYears.includes(year) ? null : { year, count: holidaysThisYear },
  };
}

export async function listUsers(ctx: ServiceContext) {
  const actor = actorOf(ctx);
  if (!authorize(actor, 'user.manage') && !authorize(actor, 'user.resetPassword') && !authorize(actor, 'assignmentRule.manage') && !authorize(actor, 'lead.assign')) {
    throw new DomainError('VALIDATION_ERROR', 'Bạn không có quyền xem danh sách người dùng');
  }
  const [users, loads] = await Promise.all([
    ctx.db.user.findMany({
      where: { orgId: ctx.orgId, deletedAt: null },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: { id: true, email: true, phone: true, fullName: true, role: true, status: true, maxOpenLeads: true, lastLoginAt: true, mustChangePassword: true, zaloBotChatId: true },
    }),
    ctx.db.lead.groupBy({ by: ['ownerId'], where: { orgId: ctx.orgId, status: { in: ['ASSIGNED', 'IN_PROGRESS'] }, deletedAt: null }, _count: true }),
  ]);
  const loadOf = new Map(loads.map((l) => [l.ownerId, l._count]));
  return users.map((u) => ({ ...u, zaloLinked: Boolean(u.zaloBotChatId), zaloBotChatId: undefined, openLeads: loadOf.get(u.id) ?? 0 }));
}
