// Tasks (SPEC 6.9). M2 needs create / complete / today's list for the Zalo Bot (HEN, XONG, HOMNAY)
// and the task-reminder job; the "Việc của tôi" screen arrives in M5 on top of these services.
import { assertAuthorized, authorize, scopeFilter } from '@michio/auth';
import type { TaskType } from '@michio/db';
import { formatDateTime, vnDayRange } from '@michio/shared';
import { z } from 'zod';
import { recordAudit } from './audit';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';
import { notifyUsers } from './notifications';

const TASK_TYPES = ['CALL', 'MESSAGE', 'SEND_QUOTE', 'FOLLOW_UP', 'REORDER', 'MEETING', 'OTHER'] as const;

export const TaskCreateInput = z.object({
  title: z.string().trim().min(1, 'Cần nội dung việc').max(200),
  type: z.enum(TASK_TYPES).default('FOLLOW_UP'),
  dueAt: z.coerce.date(),
  leadId: z.string().optional(),
  customerId: z.string().optional(),
  note: z.string().trim().max(2000).optional(),
  /** Defaults to the actor. Assigning someone else needs ALL scope (Owner/Manager). */
  assigneeId: z.string().optional(),
  remindBeforeMinutes: z.number().int().min(0).max(24 * 60).default(15),
});

/** Guess a task type from free text ("gọi lại…" → CALL). */
export function guessTaskType(text: string): TaskType {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/^(goi|call)\b/.test(t)) return 'CALL';
  if (/bao gia/.test(t)) return 'SEND_QUOTE';
  if (/^(nhan tin|nhan zalo|nhan)\b/.test(t)) return 'MESSAGE';
  if (/gap|hop/.test(t)) return 'MEETING';
  return 'FOLLOW_UP';
}

function requireActor(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

export async function createTask(ctx: ServiceContext, raw: z.input<typeof TaskCreateInput>) {
  const actor = requireActor(ctx);
  const input = TaskCreateInput.parse(raw);
  const assigneeId = input.assigneeId ?? actor.id;
  assertAuthorized(actor, 'task.manage', { orgId: ctx.orgId, assigneeId });

  return ctx.db.$transaction(async (tx) => {
    let customerId = input.customerId ?? null;
    if (input.leadId) {
      const lead = await tx.lead.findFirst({ where: { id: input.leadId, orgId: ctx.orgId, deletedAt: null } });
      if (!lead || !authorize(actor, 'lead.view', lead)) throw notFound('lead');
      customerId ??= lead.customerId;
    }
    const task = await tx.task.create({
      data: {
        orgId: ctx.orgId,
        title: input.title,
        type: input.type,
        dueAt: input.dueAt,
        assigneeId,
        createdById: actor.id,
        customerId,
        leadId: input.leadId ?? null,
        note: input.note ?? null,
        remindBeforeMinutes: input.remindBeforeMinutes,
      },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'task.create', entityType: 'Task', entityId: task.id,
      after: { code: task.code, title: task.title, dueAt: task.dueAt.toISOString(), assigneeId, leadId: task.leadId }, ip: ctx.ip,
    });
    return task;
  }, TX_OPTIONS);
}

/** XONG: complete by short code (bot) or id (web). */
export async function completeTask(ctx: ServiceContext, ref: { code: number } | { id: string }) {
  const actor = requireActor(ctx);
  return ctx.db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { orgId: ctx.orgId, ...('code' in ref ? { code: ref.code } : { id: ref.id }) } });
    if (!task || !authorize(actor, 'task.view', task)) throw notFound(`việc ${'code' in ref ? `#V${ref.code}` : ''}`.trim());
    assertAuthorized(actor, 'task.manage', task);
    if (task.status !== 'TODO') throw new DomainError('INVALID_STATE', `Việc #V${task.code} đã ${task.status === 'DONE' ? 'hoàn thành' : 'hủy'} trước đó`);
    const now = ctx.now();
    const done = await tx.task.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: now } });
    await tx.activity.create({
      data: { orgId: ctx.orgId, customerId: task.customerId, leadId: task.leadId, userId: actor.id, type: 'TASK_DONE', data: { taskId: task.id, title: task.title }, createdAt: now },
    });
    if (task.leadId) await tx.lead.update({ where: { id: task.leadId }, data: { lastActivityAt: now } });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'task.complete', entityType: 'Task', entityId: task.id,
      before: { status: task.status }, after: { status: 'DONE' }, ip: ctx.ip,
    });
    return done;
  }, TX_OPTIONS);
}

/** Open tasks due before the end of today (overdue included), for HOMNAY and the digest. */
export async function tasksDueToday(ctx: ServiceContext, userId?: string) {
  const actor = requireActor(ctx);
  const today = vnDayRange(ctx.now());
  return ctx.db.task.findMany({
    where: { ...scopeFilter(actor, 'task'), ...(userId ? { assigneeId: userId } : {}), status: 'TODO', dueAt: { lt: today.end } },
    orderBy: { dueAt: 'asc' },
    take: 30,
    include: { customer: { select: { contactName: true, shopName: true } }, lead: { select: { code: true } } },
  });
}

/** "📌 15:00 Gọi lại Shop ABC (#1201): gửi báo giá matcha" (SPEC 5.5). */
export function describeTask(t: { code: number; title: string; dueAt: Date; customer?: { contactName: string; shopName: string | null } | null; lead?: { code: number } | null }) {
  const who = t.customer ? ` ${t.customer.shopName ?? t.customer.contactName}` : '';
  const lead = t.lead ? ` (#${t.lead.code})` : '';
  return `${formatDateTime(t.dueAt).slice(11)}${who}${lead}: ${t.title} — việc V${t.code}`;
}

/**
 * `task-reminder` (every minute, SPEC §9): one "task.due" notification per task when
 * `dueAt - remindBeforeMinutes` has passed. Idempotent: a reminder already sent is never repeated.
 */
export async function remindDueTasks(ctx: ServiceContext) {
  const now = ctx.now();
  const candidates = await ctx.db.task.findMany({
    where: { orgId: ctx.orgId, status: 'TODO', dueAt: { gte: new Date(now.getTime() - 30 * 60_000), lte: new Date(now.getTime() + 24 * 60 * 60_000) } },
    include: { customer: { select: { contactName: true, shopName: true } }, lead: { select: { code: true } } },
    take: 500,
  });
  const due = candidates.filter((t) => t.dueAt.getTime() - t.remindBeforeMinutes * 60_000 <= now.getTime());
  if (!due.length) return { reminded: 0 };
  const links = due.map((t) => `/viec-cua-toi?task=${t.id}`);
  const sent = new Set(
    (await ctx.db.notification.findMany({ where: { type: 'task.due', link: { in: links } }, select: { link: true } })).map((n) => n.link),
  );
  let reminded = 0;
  for (const t of due) {
    const link = `/viec-cua-toi?task=${t.id}`;
    if (sent.has(link)) continue;
    const outbox = new Outbox(ctx.effects);
    await ctx.db.$transaction(async (tx) => {
      await notifyUsers(tx, outbox, ctx.orgId, [t.assigneeId], { type: 'task.due', title: `📌 ${describeTask(t)}`, body: `Xong thì nhắn: XONG ${t.code}`, link });
    });
    outbox.publish({ type: 'task.due', orgId: ctx.orgId, audience: { userIds: [t.assigneeId] }, data: { taskId: t.id } });
    await outbox.flush();
    reminded++;
  }
  return { reminded };
}

// ---------- S11 Việc của tôi (M5) ----------

export const TaskListFilters = z.object({
  /** overdue / today / upcoming / done — the S11 tabs; empty = all open. */
  bucket: z.enum(['overdue', 'today', 'upcoming', 'done']).optional(),
  assigneeId: z.string().optional(),
  type: z.enum(TASK_TYPES).optional(),
  customerId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function listTasks(ctx: ServiceContext, raw: z.input<typeof TaskListFilters> = {}) {
  const actor = requireActor(ctx);
  const f = TaskListFilters.parse(raw);
  const now = ctx.now();
  const today = vnDayRange(now);
  const base = { ...scopeFilter(actor, 'task'), ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}), ...(f.type ? { type: f.type } : {}), ...(f.customerId ? { customerId: f.customerId } : {}) };
  const buckets = {
    overdue: { status: 'TODO' as const, dueAt: { lt: now } },
    today: { status: 'TODO' as const, dueAt: { gte: now, lt: today.end } },
    upcoming: { status: 'TODO' as const, dueAt: { gte: today.end } },
    done: { status: { in: ['DONE' as const, 'CANCELLED' as const] }, updatedAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } },
  };
  const include = {
    customer: { select: { id: true, contactName: true, shopName: true, phone: true } },
    lead: { select: { id: true, code: true } },
    quote: { select: { id: true, code: true } },
    assignee: { select: { id: true, fullName: true } },
  } as const;
  const [items, counts] = await Promise.all([
    ctx.db.task.findMany({
      where: { ...base, ...(f.bucket ? buckets[f.bucket] : { status: 'TODO' }) },
      orderBy: f.bucket === 'done' ? { updatedAt: 'desc' } : { dueAt: 'asc' },
      take: f.limit,
      include,
    }),
    Promise.all((['overdue', 'today', 'upcoming'] as const).map((b) => ctx.db.task.count({ where: { ...base, ...buckets[b] } }))),
  ]);
  return { items, counts: { overdue: counts[0]!, today: counts[1]!, upcoming: counts[2]! } };
}

export const TaskUpdateInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  type: z.enum(TASK_TYPES).optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['TODO', 'CANCELLED']).optional(),
  assigneeId: z.string().optional(),
});

/** Reschedule / edit / cancel / reassign (reassigning to someone else needs ALL scope). */
export async function updateTask(ctx: ServiceContext, taskId: string, raw: z.input<typeof TaskUpdateInput>) {
  const actor = requireActor(ctx);
  const input = TaskUpdateInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, orgId: ctx.orgId } });
    if (!task || !authorize(actor, 'task.view', task)) throw notFound('việc');
    assertAuthorized(actor, 'task.manage', task);
    if (input.assigneeId && input.assigneeId !== task.assigneeId) assertAuthorized(actor, 'task.manage', { orgId: ctx.orgId, assigneeId: input.assigneeId });
    if (task.status === 'DONE') throw new DomainError('INVALID_STATE', 'Việc đã hoàn thành');
    const updated = await tx.task.update({ where: { id: task.id }, data: { ...input, ...(input.status === 'CANCELLED' ? { completedAt: ctx.now() } : {}) } });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: input.status === 'CANCELLED' ? 'task.cancel' : 'task.update', entityType: 'Task', entityId: task.id,
      before: { title: task.title, dueAt: task.dueAt.toISOString(), status: task.status, assigneeId: task.assigneeId },
      after: { title: updated.title, dueAt: updated.dueAt.toISOString(), status: updated.status, assigneeId: updated.assigneeId }, ip: ctx.ip,
    });
    return updated;
  }, TX_OPTIONS);
}
