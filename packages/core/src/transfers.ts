// Chuyển giao khi nhân viên nghỉ (S14, SPEC 6.10): move a salesperson's customers, open leads, open
// deals, open quotes and open tasks to one person or round-robin, in chunks (AC: 1.000 records < 1 min),
// with one AuditLog row per moved record. Runs as the `transfer` job; progress via BullMQ.
import { assertAuthorized } from '@michio/auth';
import type { Prisma } from '@michio/db';
import { z } from 'zod';
import { reclaimPendingForUser } from './assignment';
import { recordAudit } from './audit';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';
import { notifyUsers } from './notifications';

const CHUNK = 250;
const OPEN_QUOTES = ['DRAFT', 'PENDING_APPROVAL', 'SENT'] as const;

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  assertAuthorized(ctx.actor, 'transfer.manage');
  return ctx.actor;
}

/** Step 1 of the wizard: what the person currently holds. */
export async function previewTransfer(ctx: ServiceContext, fromUserId: string) {
  actorOf(ctx);
  const user = await ctx.db.user.findFirst({ where: { id: fromUserId, orgId: ctx.orgId, deletedAt: null }, select: { id: true, fullName: true, role: true, status: true } });
  if (!user) throw notFound('người dùng');
  const [customers, openLeads, pendingLeads, deals, quotes, tasks] = await Promise.all([
    ctx.db.customer.count({ where: { orgId: ctx.orgId, ownerId: fromUserId, deletedAt: null } }),
    ctx.db.lead.count({ where: { orgId: ctx.orgId, ownerId: fromUserId, deletedAt: null, status: 'IN_PROGRESS' } }),
    ctx.db.leadAssignment.count({ where: { userId: fromUserId, status: 'PENDING', lead: { orgId: ctx.orgId, deletedAt: null } } }),
    ctx.db.deal.count({ where: { orgId: ctx.orgId, ownerId: fromUserId, deletedAt: null, closedAt: null } }),
    ctx.db.quote.count({ where: { orgId: ctx.orgId, ownerId: fromUserId, status: { in: [...OPEN_QUOTES] } } }),
    ctx.db.task.count({ where: { orgId: ctx.orgId, assigneeId: fromUserId, status: 'TODO' } }),
  ]);
  return { user, counts: { customers, openLeads, pendingLeads, deals, quotes, tasks } };
}

export const TransferInput = z
  .object({
    fromUserId: z.string(),
    mode: z.enum(['ONE', 'ROUND_ROBIN']),
    toUserId: z.string().optional(),
    toUserIds: z.array(z.string()).max(50).optional(),
    deactivate: z.boolean().default(false),
  })
  .refine((v) => (v.mode === 'ONE' ? Boolean(v.toUserId) : (v.toUserIds?.length ?? 0) > 0), { message: 'Chọn người nhận', path: ['toUserId'] });
export type TransferInput = z.input<typeof TransferInput>;

export interface TransferSummary {
  customers: number;
  leads: number;
  pendingRerouted: number;
  deals: number;
  quotes: number;
  tasks: number;
  perUser: Record<string, { name: string; customers: number; leads: number; deals: number; quotes: number; tasks: number }>;
  deactivated: boolean;
}

/** Validate before queueing, so the wizard can show errors immediately. */
export async function validateTransfer(ctx: ServiceContext, raw: TransferInput) {
  actorOf(ctx);
  const input = TransferInput.parse(raw);
  const targetIds = input.mode === 'ONE' ? [input.toUserId!] : [...new Set(input.toUserIds)];
  if (targetIds.includes(input.fromUserId)) throw new DomainError('VALIDATION_ERROR', 'Người nhận phải khác người chuyển');
  const from = await ctx.db.user.findFirst({ where: { id: input.fromUserId, orgId: ctx.orgId, deletedAt: null } });
  if (!from) throw notFound('người chuyển');
  const targets = await ctx.db.user.findMany({
    where: { id: { in: targetIds }, orgId: ctx.orgId, deletedAt: null, status: { not: 'INACTIVE' }, role: { in: ['OWNER', 'MANAGER', 'SALES'] } },
    select: { id: true, fullName: true },
  });
  if (targets.length !== targetIds.length) throw new DomainError('VALIDATION_ERROR', 'Người nhận không hợp lệ hoặc đã nghỉ việc');
  if (from.role === 'OWNER' && input.deactivate) throw new DomainError('VALIDATION_ERROR', 'Không thể khóa tài khoản Owner');
  return { input, from, targets: targetIds.map((id) => targets.find((t) => t.id === id)!) };
}

/** Customers keep their open leads / deals / quotes / tasks together under the same new owner. */
export async function runTransfer(ctx: ServiceContext, raw: TransferInput, onProgress?: (done: number, total: number) => Promise<unknown> | void): Promise<TransferSummary> {
  const actor = actorOf(ctx);
  const { input, from, targets } = await validateTransfer(ctx, raw);
  const now = ctx.now();
  const org = { orgId: ctx.orgId };

  // Waiting-to-accept leads go back through the assignment engine (excluding the person leaving).
  const pendingRerouted = (await reclaimPendingForUser(ctx, from.id, 'Chuyển giao khách')).length;

  const [customers, leads, deals, quotes, tasks] = await Promise.all([
    ctx.db.customer.findMany({ where: { ...org, ownerId: from.id, deletedAt: null }, select: { id: true, contactName: true, shopName: true }, orderBy: { createdAt: 'asc' } }),
    ctx.db.lead.findMany({ where: { ...org, ownerId: from.id, deletedAt: null, status: 'IN_PROGRESS' }, select: { id: true, customerId: true } }),
    ctx.db.deal.findMany({ where: { ...org, ownerId: from.id, deletedAt: null, closedAt: null }, select: { id: true, customerId: true } }),
    ctx.db.quote.findMany({ where: { ...org, ownerId: from.id, status: { in: [...OPEN_QUOTES] } }, select: { id: true, customerId: true } }),
    ctx.db.task.findMany({ where: { ...org, assigneeId: from.id, status: 'TODO' }, select: { id: true, customerId: true } }),
  ]);

  // Who gets which customer (round robin in creation order); records without a known customer follow suit.
  const ownerOf = new Map<string, string>();
  let rr = 0;
  const pick = (customerId: string | null) => {
    if (customerId && ownerOf.has(customerId)) return ownerOf.get(customerId)!;
    const to = input.mode === 'ONE' ? targets[0]!.id : targets[rr++ % targets.length]!.id;
    if (customerId) ownerOf.set(customerId, to);
    return to;
  };
  for (const c of customers) pick(c.id);

  type Kind = 'customer' | 'lead' | 'deal' | 'quote' | 'task';
  const work: { kind: Kind; id: string; to: string; customerId: string | null }[] = [
    ...customers.map((c) => ({ kind: 'customer' as const, id: c.id, to: pick(c.id), customerId: c.id })),
    ...leads.map((l) => ({ kind: 'lead' as const, id: l.id, to: pick(l.customerId), customerId: l.customerId })),
    ...deals.map((d) => ({ kind: 'deal' as const, id: d.id, to: pick(d.customerId), customerId: d.customerId })),
    ...quotes.map((q) => ({ kind: 'quote' as const, id: q.id, to: pick(q.customerId), customerId: q.customerId })),
    ...tasks.map((t) => ({ kind: 'task' as const, id: t.id, to: pick(t.customerId), customerId: t.customerId })),
  ];
  const perUser: TransferSummary['perUser'] = Object.fromEntries(targets.map((t) => [t.id, { name: t.fullName, customers: 0, leads: 0, deals: 0, quotes: 0, tasks: 0 }]));
  const plural = { customer: 'customers', lead: 'leads', deal: 'deals', quote: 'quotes', task: 'tasks' } as const;

  for (let i = 0; i < work.length; i += CHUNK) {
    const chunk = work.slice(i, i + CHUNK);
    await ctx.db.$transaction(async (tx) => {
      for (const t of targets) {
        const ids = (k: Kind) => chunk.filter((w) => w.kind === k && w.to === t.id).map((w) => w.id);
        const c = ids('customer');
        const l = ids('lead');
        const d = ids('deal');
        const q = ids('quote');
        const k = ids('task');
        if (c.length) await tx.customer.updateMany({ where: { id: { in: c } }, data: { ownerId: t.id } });
        if (l.length) {
          await tx.lead.updateMany({ where: { id: { in: l } }, data: { ownerId: t.id, lastActivityAt: now } });
          await tx.leadAssignment.updateMany({ where: { leadId: { in: l }, status: { in: ['ACCEPTED', 'PENDING'] } }, data: { status: 'REASSIGNED' } });
          // D-016: a manager's handover is accepted directly.
          await tx.leadAssignment.createMany({ data: l.map((leadId) => ({ leadId, userId: t.id, method: 'TRANSFER' as const, status: 'ACCEPTED' as const, assignedById: actor.id, respondedAt: now, createdAt: now })) });
          await tx.activity.createMany({
            data: chunk.filter((w) => w.kind === 'lead' && w.to === t.id).map((w) => ({
              orgId: ctx.orgId, customerId: w.customerId, leadId: w.id, userId: actor.id, type: 'ASSIGNMENT' as const,
              data: { kind: 'transfer', fromUserId: from.id, toUserId: t.id, toUserName: t.fullName, method: 'TRANSFER' } as Prisma.InputJsonValue, createdAt: now,
            })),
          });
        }
        if (d.length) await tx.deal.updateMany({ where: { id: { in: d } }, data: { ownerId: t.id } });
        if (q.length) await tx.quote.updateMany({ where: { id: { in: q } }, data: { ownerId: t.id } });
        if (k.length) await tx.task.updateMany({ where: { id: { in: k } }, data: { assigneeId: t.id } });
      }
      // Audit: one row per moved record (6.10 AC "AuditLog đầy đủ"), append-only.
      await tx.auditLog.createMany({
        data: chunk.map((w) => ({
          orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: `transfer.${w.kind}`, entityType: w.kind[0]!.toUpperCase() + w.kind.slice(1), entityId: w.id,
          before: { [w.kind === 'task' ? 'assigneeId' : 'ownerId']: from.id }, after: { [w.kind === 'task' ? 'assigneeId' : 'ownerId']: w.to }, ip: ctx.ip ?? null,
        })),
      });
    }, TX_OPTIONS);
    for (const w of chunk) perUser[w.to]![plural[w.kind]]++;
    await onProgress?.(Math.min(i + CHUNK, work.length), work.length);
  }

  const outbox = new Outbox(ctx.effects);
  await ctx.db.$transaction(async (tx) => {
    if (input.deactivate && from.status !== 'INACTIVE') {
      await tx.user.update({ where: { id: from.id }, data: { status: 'INACTIVE' } });
      await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'user.deactivate', entityType: 'User', entityId: from.id, before: { status: from.status }, after: { status: 'INACTIVE', reason: 'transfer' }, ip: ctx.ip });
    }
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'transfer.run', entityType: 'User', entityId: from.id,
      after: { mode: input.mode, to: targets.map((t) => t.id), customers: customers.length, leads: leads.length, deals: deals.length, quotes: quotes.length, tasks: tasks.length, pendingRerouted, deactivate: input.deactivate },
      ip: ctx.ip,
    });
    // "Người nhận được danh sách khách qua Zalo Bot" (6.10).
    for (const t of targets) {
      const mine = customers.filter((c) => ownerOf.get(c.id) === t.id);
      const p = perUser[t.id]!;
      if (!p.customers && !p.leads && !p.tasks && !p.quotes) continue;
      const names = mine.slice(0, 15).map((c) => `– ${c.shopName ?? c.contactName}`);
      await notifyUsers(tx, outbox, ctx.orgId, [t.id], {
        type: 'transfer.received',
        title: `📥 Bạn nhận ${p.customers} khách, ${p.leads} lead, ${p.tasks} việc từ ${from.fullName}`,
        body: [...names, ...(mine.length > 15 ? [`… và ${mine.length - 15} khách khác`] : []), p.quotes ? `${p.quotes} báo giá đang mở` : ''].filter(Boolean).join('\n'),
        link: '/khach-hang',
      });
    }
  }, TX_OPTIONS);
  outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: targets.map((t) => t.id), roles: MANAGERS }, data: { transfer: from.id } });
  await outbox.flush();
  return { customers: customers.length, leads: leads.length, pendingRerouted, deals: deals.length, quotes: quotes.length, tasks: tasks.length, perUser, deactivated: input.deactivate };
}
