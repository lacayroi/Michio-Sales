// Chỉ tiêu tháng (SPEC 6.11) and Audit log viewer (S19, 6.12).
import { assertAuthorized } from '@michio/auth';
import type { Prisma } from '@michio/db';
import { vnMonthRange } from '@michio/shared';
import { z } from 'zod';
import { recordAudit } from './audit';
import type { ServiceContext } from './context';
import { DomainError } from './errors';

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Tháng dạng yyyy-MM');

/** Targets of a month with actuals (revenue, new customers, orders) per sales. */
export async function listTargets(ctx: ServiceContext, month?: string) {
  const actor = actorOf(ctx);
  const key = month ? MONTH.parse(month) : vnMonthRange(ctx.now()).key;
  const range = vnMonthRange(new Date(`${key}-15T05:00:00Z`));
  const own = actor.role === 'SALES';
  if (!own) assertAuthorized(actor, 'report.view');
  const users = await ctx.db.user.findMany({
    where: { orgId: ctx.orgId, deletedAt: null, ...(own ? { id: actor.id } : { OR: [{ role: 'SALES', status: { not: 'INACTIVE' } }, { targets: { some: { month: key } } }] }) },
    select: { id: true, fullName: true, role: true, status: true },
    orderBy: { fullName: 'asc' },
  });
  const ids = users.map((u) => u.id);
  const [targets, orders, newCustomers] = await Promise.all([
    ctx.db.target.findMany({ where: { orgId: ctx.orgId, month: key, userId: { in: ids } } }),
    ctx.db.order.groupBy({ by: ['ownerId'], where: { orgId: ctx.orgId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, ownerId: { in: ids }, orderedAt: { gte: range.start, lt: range.end } }, _sum: { total: true }, _count: true }),
    ctx.db.customer.groupBy({ by: ['ownerId'], where: { orgId: ctx.orgId, deletedAt: null, ownerId: { in: ids }, firstOrderAt: { gte: range.start, lt: range.end } }, _count: true }),
  ]);
  return {
    month: key,
    rows: users.map((u) => {
      const t = targets.find((x) => x.userId === u.id);
      const o = orders.find((x) => x.ownerId === u.id);
      return {
        userId: u.id, fullName: u.fullName, status: u.status,
        target: t ? { revenue: Number(t.revenue), newCustomers: t.newCustomers, orders: t.orders } : null,
        actual: { revenue: Number(o?._sum.total ?? 0), orders: o?._count ?? 0, newCustomers: newCustomers.find((x) => x.ownerId === u.id)?._count ?? 0 },
      };
    }),
  };
}

export const TargetsInput = z.object({
  month: MONTH,
  rows: z.array(z.object({
    userId: z.string(),
    revenue: z.coerce.number().int().min(0),
    newCustomers: z.coerce.number().int().min(0).nullable().optional(),
    orders: z.coerce.number().int().min(0).nullable().optional(),
  })).min(1).max(100),
});

/** PUT /targets — Owner/Manager set the month's targets (upsert per sales). */
export async function saveTargets(ctx: ServiceContext, raw: z.input<typeof TargetsInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'target.manage');
  const input = TargetsInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { id: { in: input.rows.map((r) => r.userId) }, orgId: ctx.orgId }, select: { id: true } });
    if (users.length !== new Set(input.rows.map((r) => r.userId)).size) throw new DomainError('VALIDATION_ERROR', 'Người dùng không hợp lệ');
    for (const r of input.rows) {
      const before = await tx.target.findUnique({ where: { userId_month: { userId: r.userId, month: input.month } } });
      const data = { revenue: r.revenue, newCustomers: r.newCustomers ?? null, orders: r.orders ?? null };
      const t = await tx.target.upsert({ where: { userId_month: { userId: r.userId, month: input.month } }, create: { orgId: ctx.orgId, userId: r.userId, month: input.month, ...data }, update: data });
      await recordAudit(tx, {
        orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'target.save', entityType: 'Target', entityId: t.id,
        before: before ? { revenue: Number(before.revenue), newCustomers: before.newCustomers, orders: before.orders } : undefined,
        after: { month: input.month, userId: r.userId, ...data }, ip: ctx.ip,
      });
    }
    return { saved: input.rows.length };
  });
}

// ---------- S19 Audit log ----------

export const AuditFilters = z.object({
  actorId: z.string().optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  action: z.string().max(60).optional(),
  via: z.enum(['WEB', 'ZALO_BOT', 'API', 'SYSTEM']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listAuditLogs(ctx: ServiceContext, raw: z.input<typeof AuditFilters>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'auditLog.view');
  const f = AuditFilters.parse(raw);
  const where: Prisma.AuditLogWhereInput = { orgId: ctx.orgId };
  if (f.actorId) where.actorId = f.actorId === 'system' ? null : f.actorId;
  if (f.entityType) where.entityType = f.entityType;
  if (f.entityId) where.entityId = f.entityId;
  if (f.action) where.action = { startsWith: f.action };
  if (f.via) where.via = f.via;
  if (f.from || f.to) where.createdAt = { gte: f.from, lt: f.to };
  const rows = await ctx.db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  const actors = await ctx.db.user.findMany({ where: { id: { in: [...new Set(items.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
  const [entityTypes, actions] = await Promise.all([
    ctx.db.auditLog.findMany({ where: { orgId: ctx.orgId }, distinct: ['entityType'], select: { entityType: true }, take: 50 }),
    ctx.db.auditLog.findMany({ where: { orgId: ctx.orgId }, distinct: ['action'], select: { action: true }, take: 200 }),
  ]);
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    actors: Object.fromEntries(actors.map((a) => [a.id, a.fullName])),
    entityTypes: entityTypes.map((e) => e.entityType).sort(),
    actions: actions.map((a) => a.action).sort(),
  };
}
