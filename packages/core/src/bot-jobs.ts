// Scheduled bot notifications (SPEC 5.5, §9): "còn 3 phút để nhận lead" and the 08:00 digest.
// Both create ordinary Notification rows, so they show in the web bell and reach Zalo through the
// same delivery queue (respecting preferences and working hours).
import type { AuthUser } from '@michio/auth';
import { formatDate, formatVnd, LEAD_SOURCE_LABELS, vnDayRange, vnMonthRange } from '@michio/shared';
import { zaloEnabled } from './bot-account';
import { isBusinessTime, vnDateKey } from './business-time';
import { loadCalendar } from './calendar';
import { Outbox, type ServiceContext } from './context';
import { notifyUsers } from './notifications';
import { describeTask } from './tasks';

export const EXPIRY_WARNING_MINUTES = 3;

/** Every minute: warn assignees whose accept deadline is ≤ 3 minutes away. Once per assignment. */
export async function warnExpiringAssignments(ctx: ServiceContext) {
  const now = ctx.now();
  const soon = await ctx.db.leadAssignment.findMany({
    where: { status: 'PENDING', acceptDeadline: { gt: now, lte: new Date(now.getTime() + EXPIRY_WARNING_MINUTES * 60_000) }, lead: { orgId: ctx.orgId, deletedAt: null } },
    include: { lead: { select: { id: true, code: true } } },
    take: 200,
  });
  let warned = 0;
  for (const a of soon) {
    const link = `/leads/${a.lead.id}?a=${a.id}`;
    if (await ctx.db.notification.findFirst({ where: { type: 'lead.expiring', link }, select: { id: true } })) continue;
    const minutes = Math.max(1, Math.ceil((a.acceptDeadline!.getTime() - now.getTime()) / 60_000));
    const outbox = new Outbox(ctx.effects);
    await ctx.db.$transaction((tx) =>
      notifyUsers(tx, outbox, ctx.orgId, [a.userId], {
        type: 'lead.expiring',
        title: `⏰ Còn ${minutes} phút để nhận lead #${a.lead.code} → NHAN ${a.lead.code}`,
        body: 'Quá hạn lead sẽ chuyển cho người khác.',
        link,
      }),
    );
    outbox.publish({ type: 'assignment.expiring', orgId: ctx.orgId, audience: { userIds: [a.userId] }, data: { leadId: a.lead.id, acceptDeadline: a.acceptDeadline!.toISOString() } });
    await outbox.flush();
    warned++;
  }
  return { warned };
}

const bullets = (items: string[], max = 5) => [...items.slice(0, max).map((i) => `  – ${i}`), ...(items.length > max ? [`  … và ${items.length - max} mục khác`] : [])];

async function salesDigest(ctx: ServiceContext, user: AuthUser & { fullName: string }) {
  const now = ctx.now();
  const today = vnDayRange(now);
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const [pending, toContact, tasks, reorder, atRisk] = await Promise.all([
    ctx.db.leadAssignment.findMany({ where: { userId: user.id, status: 'PENDING', lead: { deletedAt: null } }, include: { lead: { include: { customer: { select: { contactName: true } } } } }, orderBy: { acceptDeadline: 'asc' } }),
    ctx.db.lead.findMany({ where: { ownerId: user.id, status: 'IN_PROGRESS', firstContactAt: null, deletedAt: null }, include: { customer: { select: { contactName: true } } }, take: 20 }),
    ctx.db.task.findMany({ where: { assigneeId: user.id, status: 'TODO', dueAt: { lt: today.end } }, orderBy: { dueAt: 'asc' }, include: { customer: { select: { contactName: true, shopName: true } }, lead: { select: { code: true } } } }),
    ctx.db.customer.findMany({ where: { ownerId: user.id, deletedAt: null, orderCount: { gt: 0 }, nextReorderAt: { lte: soon }, lifecycle: { notIn: ['AT_RISK', 'DORMANT'] } }, orderBy: { nextReorderAt: 'asc' }, take: 20 }),
    ctx.db.customer.findMany({ where: { ownerId: user.id, deletedAt: null, lifecycle: 'AT_RISK' }, take: 20 }),
  ]);
  const lines = [`☀️ Chào ${user.fullName}, tổng kết sáng ${formatDate(now)}:`];
  lines.push(`• Lead chờ nhận: ${pending.length}`, ...bullets(pending.map((a) => `#${a.lead.code} ${a.lead.customer.contactName} → NHAN ${a.lead.code}`)));
  lines.push(`• Lead chưa liên hệ: ${toContact.length}`, ...bullets(toContact.map((l) => `#${l.code} ${l.customer.contactName}`)));
  lines.push(`• Việc hôm nay: ${tasks.length}`, ...bullets(tasks.map((t) => describeTask(t))));
  lines.push(`• Khách cần nhắc tái đặt: ${reorder.length}`, ...bullets(reorder.map((c) => `${c.shopName ?? c.contactName}${c.nextReorderAt ? ` (hẹn ${formatDate(c.nextReorderAt)})` : ''}`)));
  if (atRisk.length) lines.push(`• ⚠️ Khách có nguy cơ rời bỏ: ${atRisk.length}`, ...bullets(atRisk.map((c) => c.shopName ?? c.contactName), 3));
  lines.push('Gõ HOMNAY để xem lại bất cứ lúc nào.');
  return lines.join('\n');
}

async function managerDigest(ctx: ServiceContext, user: AuthUser & { fullName: string }) {
  const now = ctx.now();
  const yesterday = vnDayRange(new Date(now.getTime() - 86_400_000));
  const month = vnMonthRange(now);
  const base = { orgId: ctx.orgId, deletedAt: null };
  const [bySource, queued, waiting, overdueContact, revenue, targets, atRisk] = await Promise.all([
    ctx.db.lead.groupBy({ by: ['source'], where: { ...base, createdAt: { gte: yesterday.start, lt: yesterday.end } }, _count: true }),
    ctx.db.lead.count({ where: { ...base, status: { in: ['NEW', 'UNASSIGNED'] } } }),
    ctx.db.lead.count({ where: { ...base, status: 'ASSIGNED' } }),
    ctx.db.lead.count({ where: { ...base, status: 'IN_PROGRESS', firstContactAt: null, firstContactDeadline: { lt: now } } }),
    ctx.db.order.aggregate({ _sum: { total: true }, where: { ...base, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { gte: month.start, lt: month.end } } }),
    ctx.db.target.aggregate({ _sum: { revenue: true }, where: { orgId: ctx.orgId, month: month.key } }),
    ctx.db.customer.count({ where: { ...base, lifecycle: 'AT_RISK' } }),
  ]);
  const total = bySource.reduce((s, x) => s + x._count, 0);
  const rev = Number(revenue._sum.total ?? 0);
  const target = Number(targets._sum.revenue ?? 0);
  const lines = [`☀️ Chào ${user.fullName}, tổng kết sáng ${formatDate(now)}:`];
  lines.push(
    `• Lead hôm qua: ${total}${total ? ` (${bySource.sort((a, b) => b._count - a._count).map((s) => `${LEAD_SOURCE_LABELS[s.source]} ${s._count}`).join(', ')})` : ''}`,
    `• Lead chưa xử lý: ${queued} chờ giao · ${waiting} chờ nhận · ${overdueContact} quá hạn liên hệ`,
    `• Doanh số tháng: ${formatVnd(rev)}${target ? ` / chỉ tiêu ${formatVnd(target)} (${Math.round((rev / target) * 100)}%)` : ''}`,
  );
  if (atRisk) lines.push(`• ⚠️ Khách có nguy cơ rời bỏ: ${atRisk}`);
  return lines.join('\n');
}

/**
 * `daily-digest` (08:00 T2–T7, SPEC 5.5): one "daily.digest" notification per linked Sales /
 * Owner / Manager. Skips holidays; idempotent per user and day.
 */
export async function createDailyDigests(ctx: ServiceContext) {
  const now = ctx.now();
  const cal = await loadCalendar(ctx.db, ctx.orgId);
  // Only on working days: the job fires at 08:00, i.e. the opening of a working day.
  if (!isBusinessTime(new Date(vnDayRange(now).start.getTime() + 10 * 3600_000), cal)) return { created: 0, skipped: 'holiday' as const };
  const users = await ctx.db.user.findMany({
    where: { orgId: ctx.orgId, deletedAt: null, status: { not: 'INACTIVE' }, zaloBotChatId: { not: null }, role: { in: ['OWNER', 'MANAGER', 'SALES'] } },
  });
  const link = `/?digest=${vnDateKey(now)}`;
  let created = 0;
  for (const u of users) {
    if (!zaloEnabled(u.notificationPrefs, 'daily.digest')) continue;
    if (await ctx.db.notification.findFirst({ where: { userId: u.id, type: 'daily.digest', link }, select: { id: true } })) continue;
    const actor = { id: u.id, orgId: u.orgId, role: u.role, status: u.status, deletedAt: u.deletedAt, fullName: u.fullName };
    const text = u.role === 'SALES' ? await salesDigest(ctx, actor) : await managerDigest(ctx, actor);
    const [title, ...rest] = text.split('\n');
    const outbox = new Outbox(ctx.effects);
    await ctx.db.$transaction((tx) => notifyUsers(tx, outbox, ctx.orgId, [u.id], { type: 'daily.digest', title: title!, body: rest.join('\n'), link }));
    await outbox.flush();
    created++;
  }
  return { created };
}
