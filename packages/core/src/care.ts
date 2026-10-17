// Chăm khách sỉ (SPEC 6.5, 6.8, 6.9): lifecycle refresh, reorder reminders, stale-lead warnings and the
// "Khách cần chăm" list (S8). Jobs are idempotent: re-running a day never duplicates tasks or alerts.
import { scopeFilter } from '@michio/auth';
import type { Lifecycle, Prisma } from '@michio/db';
import { formatDate, formatVnd } from '@michio/shared';
import { z } from 'zod';
import { addBusinessMinutes, vnDateKey } from './business-time';
import { loadCalendar } from './calendar';
import { Outbox, type ServiceContext } from './context';
import { computeLifecycle } from './customers';
import { DomainError } from './errors';
import { notifyUsers } from './notifications';
import { getSettings } from './settings';

const DAY = 86_400_000;

/**
 * `customer-lifecycle` (01:00 daily, §9): AT_RISK / DORMANT depend on time passing, not only on orders.
 * Returns customers that just became AT_RISK (reported in the morning digest, 6.8).
 */
export async function refreshLifecycles(ctx: ServiceContext) {
  const now = ctx.now();
  const { 'reorder.dormantDays': dormantDays } = await getSettings(ctx.db, ctx.orgId, ['reorder.dormantDays']);
  const customers = await ctx.db.customer.findMany({
    where: { orgId: ctx.orgId, deletedAt: null, orderCount: { gt: 0 } },
    select: { id: true, lifecycle: true, orderCount: true, lastOrderAt: true, reorderCycleDays: true, ownerId: true },
  });
  const changes = new Map<Lifecycle, string[]>();
  for (const c of customers) {
    const next = computeLifecycle(c, now, dormantDays);
    if (next !== c.lifecycle) changes.set(next, [...(changes.get(next) ?? []), c.id]);
  }
  const atRisk: string[] = changes.get('AT_RISK') ?? [];
  for (const [lifecycle, ids] of changes) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await ctx.db.$transaction(async (tx) => {
        await tx.customer.updateMany({ where: { id: { in: chunk } }, data: { lifecycle } });
        await tx.activity.createMany({ data: chunk.map((customerId) => ({ orgId: ctx.orgId, customerId, type: 'SYSTEM' as const, data: { kind: 'lifecycle', to: lifecycle }, createdAt: now })) });
        await tx.auditLog.createMany({ data: chunk.map((entityId) => ({ orgId: ctx.orgId, via: 'SYSTEM', action: 'customer.lifecycle', entityType: 'Customer', entityId, after: { lifecycle } })) });
      });
    }
  }
  return { checked: customers.length, changed: [...changes.values()].reduce((s, x) => s + x.length, 0), atRisk };
}

/**
 * `reorder-reminder` (07:30 T2–T7, 6.8): a REORDER task for the customer's sales `reorder.remindBeforeDays`
 * before `nextReorderAt`, with the top 5 products and the last order total. `autoRuleKey =
 * reorder:{customerId}:{nextReorderAt day}` → exactly one task per cycle, however often the job runs.
 */
export async function createReorderReminders(ctx: ServiceContext) {
  const now = ctx.now();
  const s = await getSettings(ctx.db, ctx.orgId, ['reorder.remindBeforeDays', 'automation.reorderReminder']);
  if (!s['automation.reorderReminder']) return { created: 0, skipped: 'disabled' as const };
  const cal = await loadCalendar(ctx.db, ctx.orgId);
  const horizon = new Date(now.getTime() + s['reorder.remindBeforeDays'] * DAY);
  const due = await ctx.db.customer.findMany({
    where: {
      orgId: ctx.orgId, deletedAt: null, orderCount: { gt: 0 }, ownerId: { not: null }, nextReorderAt: { not: null, lte: horizon },
      lifecycle: { not: 'DORMANT' }, owner: { status: { not: 'INACTIVE' }, deletedAt: null },
    },
    include: { orders: { where: { deletedAt: null, deliveryStatus: { not: 'CANCELLED' } }, orderBy: { orderedAt: 'desc' }, take: 1 } },
  });
  let created = 0;
  for (const c of due) {
    const key = `reorder:${c.id}:${vnDateKey(c.nextReorderAt!)}`;
    if (await ctx.db.task.findFirst({ where: { orgId: ctx.orgId, autoRuleKey: key }, select: { id: true } })) continue;
    const top = await ctx.db.orderItem.groupBy({
      by: ['productId'],
      where: { order: { customerId: c.id, deletedAt: null, deliveryStatus: { not: 'CANCELLED' } } },
      _sum: { qty: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: 5,
    });
    const products = await ctx.db.product.findMany({ where: { id: { in: top.map((t) => t.productId) } }, select: { id: true, name: true, sku: true } });
    const topText = top.map((t, i) => `${i + 1}. ${products.find((p) => p.id === t.productId)?.name ?? '?'} (${Number(t._sum.qty ?? 0)})`).join('\n');
    const last = c.orders[0];
    const daysSince = c.lastOrderAt ? Math.floor((now.getTime() - c.lastOrderAt.getTime()) / DAY) : null;
    const name = c.shopName ?? c.contactName;
    const dueAt = addBusinessMinutes(new Date(Math.max(now.getTime(), c.nextReorderAt!.getTime() - s['reorder.remindBeforeDays'] * DAY)), 0, cal);
    const outbox = new Outbox(ctx.effects);
    const task = await ctx.db.$transaction(async (tx) => {
      const r = await tx.task.createManyAndReturn({
        data: [{
          orgId: ctx.orgId, title: `Nhắc tái đặt hàng — ${name}`, type: 'REORDER', dueAt, assigneeId: c.ownerId!, customerId: c.id, autoRuleKey: key,
          note: [`Đơn gần nhất ${last ? `${last.code} · ${formatVnd(last.total)} · ${formatDate(last.orderedAt)}` : '—'}; chu kỳ ${c.reorderCycleDays} ngày; dự kiến đặt lại ${formatDate(c.nextReorderAt!)}.`, topText && `Hay mua:\n${topText}`].filter(Boolean).join('\n'),
        }],
        skipDuplicates: true,
      });
      const t = r[0];
      if (!t) return null; // created concurrently
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: c.id, type: 'SYSTEM', data: { kind: 'reorder_reminder', taskId: t.id, nextReorderAt: c.nextReorderAt!.toISOString() }, createdAt: now } });
      await notifyUsers(tx, outbox, ctx.orgId, [c.ownerId!], {
        type: 'reorder.reminder',
        title: `🔁 ${name}${c.province ? ` (${c.province})` : ''} đã ${daysSince ?? '?'} ngày chưa đặt lại, chu kỳ thường ${c.reorderCycleDays} ngày.${last ? ` Đơn gần nhất ${formatVnd(last.total)}.` : ''}`,
        body: `Việc V${t.code}${topText ? ` · hay mua: ${top.slice(0, 3).map((x) => products.find((p) => p.id === x.productId)?.name).filter(Boolean).join(', ')}` : ''} → XONG ${t.code}`,
        link: `/khach-hang/${c.id}`,
      });
      return t;
    });
    await outbox.flush();
    if (task) created++;
  }
  return { created, candidates: due.length };
}

/** `stale-lead` (hourly, 6.9): leads in progress without activity for `lead.staleDays` → warn the owner once per quiet period. */
export async function warnStaleLeads(ctx: ServiceContext) {
  const now = ctx.now();
  const s = await getSettings(ctx.db, ctx.orgId, ['lead.staleDays', 'automation.staleLead']);
  if (!s['automation.staleLead']) return { warned: 0 };
  const cutoff = new Date(now.getTime() - s['lead.staleDays'] * DAY);
  const stale = await ctx.db.lead.findMany({
    where: { orgId: ctx.orgId, deletedAt: null, status: 'IN_PROGRESS', ownerId: { not: null }, lastActivityAt: { lt: cutoff } },
    include: { customer: { select: { contactName: true, shopName: true } } },
    take: 500,
  });
  let warned = 0;
  for (const l of stale) {
    // Link carries the last-activity day: a new quiet period after new activity warns again.
    const link = `/leads/${l.id}?stale=${vnDateKey(l.lastActivityAt ?? l.createdAt)}`;
    if (await ctx.db.notification.findFirst({ where: { type: 'lead.stale', link }, select: { id: true } })) continue;
    const days = Math.floor((now.getTime() - (l.lastActivityAt ?? l.createdAt).getTime()) / DAY);
    const outbox = new Outbox(ctx.effects);
    await ctx.db.$transaction((tx) =>
      notifyUsers(tx, outbox, ctx.orgId, [l.ownerId!], {
        type: 'lead.stale',
        title: `💤 Lead #${l.code} ${l.customer.shopName ?? l.customer.contactName} ${days} ngày chưa có hoạt động`,
        body: 'Gọi / nhắn khách hoặc cập nhật giai đoạn để không bỏ sót.',
        link,
      }),
    );
    await outbox.flush();
    warned++;
  }
  return { warned };
}

// ---------- S8 Khách cần chăm ----------

export const AttentionFilters = z.object({
  /** due = sắp đến hạn đặt lại, overdue = quá hạn, at_risk, dormant; empty = all four. */
  group: z.enum(['due', 'overdue', 'at_risk', 'dormant']).optional(),
  ownerId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** GET /customers/attention (§8, S8): sorted by average order value, highest first (6.8). */
export async function listAttention(ctx: ServiceContext, raw: z.input<typeof AttentionFilters> = {}) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const f = AttentionFilters.parse(raw);
  const now = ctx.now();
  const { 'reorder.remindBeforeDays': remind } = await getSettings(ctx.db, ctx.orgId, ['reorder.remindBeforeDays']);
  const soon = new Date(now.getTime() + Math.max(remind, 7) * DAY);
  const groups: Record<string, Prisma.CustomerWhereInput> = {
    due: { lifecycle: { in: ['NEW_CUSTOMER', 'REPEAT'] }, nextReorderAt: { gte: now, lte: soon } },
    overdue: { lifecycle: { in: ['NEW_CUSTOMER', 'REPEAT'] }, nextReorderAt: { lt: now } },
    at_risk: { lifecycle: 'AT_RISK' },
    dormant: { lifecycle: 'DORMANT' },
  };
  const where: Prisma.CustomerWhereInput = {
    ...scopeFilter(ctx.actor, 'customer'),
    deletedAt: null,
    orderCount: { gt: 0 },
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    OR: f.group ? [groups[f.group]!] : Object.values(groups),
  };
  const rows = await ctx.db.customer.findMany({
    where,
    include: {
      owner: { select: { id: true, fullName: true } },
      tasks: { where: { type: 'REORDER', status: 'TODO' }, select: { id: true, code: true, dueAt: true }, take: 1, orderBy: { dueAt: 'asc' } },
    },
    take: 1000,
  });
  const groupOf = (c: (typeof rows)[number]) =>
    c.lifecycle === 'DORMANT' ? 'dormant' : c.lifecycle === 'AT_RISK' ? 'at_risk' : c.nextReorderAt && c.nextReorderAt < now ? 'overdue' : 'due';
  const items = rows
    .map((c) => ({
      id: c.id, name: c.shopName ?? c.contactName, contactName: c.contactName, phone: c.phone, province: c.province, lifecycle: c.lifecycle,
      owner: c.owner, orderCount: c.orderCount, totalRevenue: Number(c.totalRevenue), avgOrderValue: c.orderCount ? Math.round(Number(c.totalRevenue) / c.orderCount) : 0,
      lastOrderAt: c.lastOrderAt, nextReorderAt: c.nextReorderAt, reorderCycleDays: c.reorderCycleDays,
      daysSinceOrder: c.lastOrderAt ? Math.floor((now.getTime() - c.lastOrderAt.getTime()) / DAY) : null,
      openTask: c.tasks[0] ?? null, group: groupOf(c) as 'due' | 'overdue' | 'at_risk' | 'dormant',
    }))
    .sort((a, b) => b.avgOrderValue - a.avgOrderValue)
    .slice(0, f.limit);
  const counts = { due: 0, overdue: 0, at_risk: 0, dormant: 0 };
  for (const r of rows) counts[groupOf(r)]++;
  return { items, counts };
}

/** Tell each sales which of their customers just became AT_RISK; Owners see the list in the 08:00 digest (6.8). */
export async function notifyAtRisk(ctx: ServiceContext, customerIds: string[]) {
  if (!customerIds.length) return;
  const customers = await ctx.db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, shopName: true, contactName: true, ownerId: true } });
  const outbox = new Outbox(ctx.effects);
  await ctx.db.$transaction(async (tx) => {
    for (const c of customers) {
      if (!c.ownerId) continue;
      await notifyUsers(tx, outbox, ctx.orgId, [c.ownerId], {
        type: 'customer.at_risk',
        title: `⚠️ ${c.shopName ?? c.contactName} có nguy cơ rời bỏ`,
        body: 'Đã quá 1,5 lần chu kỳ đặt hàng mà chưa đặt lại.',
        link: `/khach-hang/${c.id}`,
      });
    }
  });
  await outbox.flush();
}
