// Lead assignment engine (SPEC 6.3.4).
//   onLeadCreated → routeLead   (customer owner → previous owner → first matching rule → queue)
//   onSlaCheck    → expireAssignment
//   onAccept      → acceptLead
//   onReturn      → returnLead
// Every function runs in one transaction; side effects (SSE, delayed SLA jobs) are flushed after commit.
import { assertAuthorized } from '@michio/auth';
import type { AssignmentMethod, AssignmentRule, Customer, Lead, Prisma } from '@michio/db';
import {
  addBusinessMinutes,
  type BusinessCalendar,
  formatDateTime,
  isBusinessTime,
  LEAD_SOURCE_LABELS,
  ORDER_BAND_LABELS,
} from '@michio/shared';
import { recordAudit } from '../audit';
import { type Actor, type Db, MANAGER_ROLES, systemActor, type Tx, TX_OPTIONS } from '../context';
import { EffectBuffer, type Effects } from '../effects';
import { ConflictError, DomainError, NotFoundError } from '../errors';
import { managerIds, notifyUsers } from '../notifications';
import { loadCalendar, loadSettings, type Settings } from '../settings';
import { defaultTargets, ineligibleReason, loadCandidateFacts } from './candidates';
import { pickLeastLoaded, pickRoundRobin, pickWeighted, type WeightState } from './pick';
import { matchesRule, type RoutableLead } from './rules';

export const DEFAULT_SLA = { acceptSlaMinutes: 10, hotAcceptSlaMinutes: 5, firstContactSlaMinutes: 30, maxReassign: 3 };

export interface EngineContext {
  actor: Actor;
  settings: Settings;
  calendar: BusinessCalendar;
  now: Date;
  fx: EffectBuffer;
  /** Bulk jobs (import) skip per-lead notifications and send one summary instead. */
  quiet?: boolean;
}

export async function engineContext(db: Db | Tx, actor: Actor, now = new Date()): Promise<EngineContext> {
  const settings = await loadSettings(db, actor.orgId);
  const calendar = await loadCalendar(db, actor.orgId, settings);
  return { actor, settings, calendar, now, fx: new EffectBuffer() };
}

export type QueueReason = 'NO_RULE' | 'MANUAL_RULE' | 'NO_CANDIDATE' | 'MAX_REASSIGN' | 'UNASSIGNED_BY_CHOICE';

export const QUEUE_REASON_LABELS: Record<QueueReason, string> = {
  NO_RULE: 'không có luật chia phù hợp',
  MANUAL_RULE: 'luật chia yêu cầu giao tay',
  NO_CANDIDATE: 'không còn sales nào nhận được',
  MAX_REASSIGN: 'đã thu hồi quá số lần cho phép',
  UNASSIGNED_BY_CHOICE: 'chưa giao',
};

export type RouteOutcome =
  | { kind: 'ASSIGNED'; assignmentId: string; userId: string; userName: string; method: AssignmentMethod; acceptDeadline: Date | null }
  | { kind: 'QUEUED'; reason: QueueReason }
  | { kind: 'HELD' };

type LeadWithCustomer = Lead & { customer: Customer };

const routable = (lead: LeadWithCustomer): RoutableLead => ({
  source: lead.source,
  priority: lead.priority,
  businessModel: lead.customer.businessModel,
  expectedOrderBand: lead.customer.expectedOrderBand,
  interestCategories: lead.customer.interestCategories,
  province: lead.customer.province,
  tags: lead.customer.tags,
});

async function lockKey(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS l`;
}

async function activeRules(tx: Tx, orgId: string) {
  return tx.assignmentRule.findMany({ where: { orgId, isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
}

/** Users who returned or let this lead expire — never offered it again (SPEC 6.3.3). */
async function previousDecliners(tx: Tx, leadId: string): Promise<string[]> {
  const rows = await tx.leadAssignment.findMany({
    where: { leadId, status: { in: ['RETURNED', 'EXPIRED'] } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/** "Lead #1234 · Chị Hoa · Shop… – Hải Phòng · Mức nhập 10–30 triệu · Nguồn: Form sỉ" */
export function describeLead(lead: LeadWithCustomer): { title: string; body: string } {
  const c = lead.customer;
  const where = [c.shopName, c.province].filter(Boolean).join(' – ');
  const parts = [
    where || null,
    c.expectedOrderBand && c.expectedOrderBand !== 'UNKNOWN' ? `Mức nhập ${ORDER_BAND_LABELS[c.expectedOrderBand]}` : null,
    `Nguồn: ${LEAD_SOURCE_LABELS[lead.source]}`,
  ].filter(Boolean);
  return { title: `Lead #${lead.code} · ${c.contactName}${lead.priority === 'HOT' ? ' · 🔥 HOT' : ''}`, body: parts.join(' · ') };
}

interface AssignInput {
  userId: string;
  method: AssignmentMethod;
  rule: AssignmentRule | null;
  assignedById?: string | null;
  /** Skip the accept step (rule.autoAccept, manual assignment, SALES self-assign). */
  accepted?: boolean;
}

async function assign(tx: Tx, ctx: EngineContext, lead: LeadWithCustomer, input: AssignInput): Promise<RouteOutcome> {
  const { now, calendar, fx } = ctx;
  const rule = input.rule;
  const accepted = input.accepted ?? rule?.autoAccept ?? false;
  const acceptMinutes =
    lead.priority === 'HOT'
      ? (rule?.hotAcceptSlaMinutes ?? DEFAULT_SLA.hotAcceptSlaMinutes)
      : (rule?.acceptSlaMinutes ?? DEFAULT_SLA.acceptSlaMinutes);
  const contactMinutes = rule?.firstContactSlaMinutes ?? DEFAULT_SLA.firstContactSlaMinutes;
  const acceptDeadline = accepted ? null : addBusinessMinutes(calendar, now, acceptMinutes);

  await tx.leadAssignment.updateMany({
    where: { leadId: lead.id, status: { in: ['PENDING', 'ACCEPTED'] } },
    data: { status: 'REASSIGNED', respondedAt: now },
  });
  const assignment = await tx.leadAssignment.create({
    data: {
      leadId: lead.id,
      userId: input.userId,
      ruleId: rule?.id ?? null,
      method: input.method,
      status: accepted ? 'ACCEPTED' : 'PENDING',
      assignedById: input.assignedById ?? null,
      acceptDeadline,
      respondedAt: accepted ? now : null,
      createdAt: now,
    },
  });
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { fullName: true } });

  const leadData: Prisma.LeadUpdateInput = {
    owner: { connect: { id: input.userId } },
    status: accepted ? 'IN_PROGRESS' : 'ASSIGNED',
    firstAssignedAt: lead.firstAssignedAt ?? now,
    acceptedAt: accepted ? now : null,
    // Bulk imports carry no first-contact SLA (it would flag every imported lead as overdue).
    firstContactDeadline: accepted && !lead.firstContactAt && !ctx.quiet ? addBusinessMinutes(calendar, now, contactMinutes) : null,
  };
  await tx.lead.update({ where: { id: lead.id }, data: leadData });

  // A prospect follows its lead; a buying customer keeps its owner until a transfer (SPEC 6.7, 6.10).
  if (lead.customer.orderCount === 0 && lead.customer.ownerId !== input.userId) {
    await tx.customer.update({ where: { id: lead.customerId }, data: { ownerId: input.userId } });
  }
  await tx.deal.updateMany({ where: { leadId: lead.id, closedAt: null }, data: { ownerId: input.userId } });

  await tx.activity.create({
    data: {
      orgId: lead.orgId,
      customerId: lead.customerId,
      leadId: lead.id,
      userId: ctx.actor.user?.id ?? null,
      type: 'ASSIGNMENT',
      data: { action: 'ASSIGNED', toUserId: input.userId, toUserName: user.fullName, method: input.method, ruleId: rule?.id ?? null },
      createdAt: now,
    },
  });
  await recordAudit(tx, {
    orgId: lead.orgId,
    actorId: ctx.actor.user?.id ?? null,
    via: ctx.actor.via,
    action: 'lead.assign',
    entityType: 'Lead',
    entityId: lead.id,
    before: { ownerId: lead.ownerId, status: lead.status },
    after: { ownerId: input.userId, status: leadData.status as string, method: input.method, assignmentId: assignment.id },
    ip: ctx.actor.ip,
  });

  if (input.userId !== ctx.actor.user?.id && !ctx.quiet) {
    const d = describeLead(lead);
    await notifyUsers(tx, fx, lead.orgId, [input.userId], {
      type: 'lead.assigned',
      title: `🔔 ${d.title}`,
      body: acceptDeadline ? `${d.body}. Nhận trước ${formatDateTime(acceptDeadline).slice(11)} ${formatDateTime(acceptDeadline).slice(0, 5)}` : d.body,
      link: `/leads/${lead.id}`,
    });
  }
  fx.publish({
    type: 'lead.assigned',
    orgId: lead.orgId,
    userIds: [input.userId, ...(lead.ownerId ? [lead.ownerId] : [])],
    roles: MANAGER_ROLES,
    data: { leadId: lead.id, code: lead.code, userId: input.userId, acceptDeadline: acceptDeadline?.toISOString() ?? null },
  });
  if (acceptDeadline) fx.scheduleSlaCheck(assignment.id, acceptDeadline);

  return { kind: 'ASSIGNED', assignmentId: assignment.id, userId: input.userId, userName: user.fullName, method: input.method, acceptDeadline };
}

async function queueLead(tx: Tx, ctx: EngineContext, lead: LeadWithCustomer, reason: QueueReason): Promise<RouteOutcome> {
  await tx.lead.update({ where: { id: lead.id }, data: { status: 'UNASSIGNED', ownerId: null, acceptedAt: null, firstContactDeadline: null } });
  await tx.activity.create({
    data: { orgId: lead.orgId, customerId: lead.customerId, leadId: lead.id, type: 'SYSTEM', data: { kind: 'QUEUED', reason }, createdAt: ctx.now },
  });
  await recordAudit(tx, {
    orgId: lead.orgId,
    actorId: ctx.actor.user?.id ?? null,
    via: ctx.actor.via,
    action: 'lead.queue',
    entityType: 'Lead',
    entityId: lead.id,
    before: { ownerId: lead.ownerId, status: lead.status },
    after: { ownerId: null, status: 'UNASSIGNED', reason },
    ip: ctx.actor.ip,
  });
  if (reason !== 'UNASSIGNED_BY_CHOICE') {
    const d = describeLead(lead);
    await notifyUsers(tx, ctx.fx, lead.orgId, await managerIds(tx, lead.orgId), {
      type: 'lead.queued',
      title: `⚠️ ${d.title} chưa có người nhận`,
      body: `Lý do: ${QUEUE_REASON_LABELS[reason]}. Vào trang lead để giao tay.`,
      link: `/leads/${lead.id}`,
    });
  }
  ctx.fx.publish({ type: 'lead.updated', orgId: lead.orgId, roles: MANAGER_ROLES, data: { leadId: lead.id, status: 'UNASSIGNED' } });
  return { kind: 'QUEUED', reason };
}

export interface RouteOptions {
  exclude?: readonly string[];
  /** Ignore `outOfHoursMode = HOLD` (manual "chia tự động", 08:00 release job). */
  ignoreHold?: boolean;
}

/** Route one lead inside an open transaction. */
export async function routeLeadTx(tx: Tx, ctx: EngineContext, leadId: string, opts: RouteOptions = {}): Promise<RouteOutcome> {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { customer: true } });
  const { settings, now, calendar } = ctx;
  const exclude = new Set([...(opts.exclude ?? []), ...(await previousDecliners(tx, lead.id))]);
  const matching = (await activeRules(tx, lead.orgId)).filter((r) => matchesRule(r.conditions, routable(lead), now));
  const slaRule = matching[0] ?? null;

  if (!opts.ignoreHold && settings['assignment.outOfHoursMode'] === 'HOLD' && !isBusinessTime(calendar, now)) {
    if (lead.status !== 'NEW') await tx.lead.update({ where: { id: lead.id }, data: { status: 'NEW', ownerId: null } });
    return { kind: 'HELD' };
  }

  // 1. Buying customer → back to the sales who owns it (SPEC 6.2 "mua lại"); INACTIVE owner → rotate.
  const c = lead.customer;
  if (settings['assignment.keepCustomerOwner'] && c.orderCount > 0 && c.ownerId && !exclude.has(c.ownerId)) {
    const owner = await tx.user.findUnique({ where: { id: c.ownerId }, select: { status: true, deletedAt: true } });
    if (owner && owner.status !== 'INACTIVE' && !owner.deletedAt) {
      return assign(tx, ctx, lead, { userId: c.ownerId, method: 'CUSTOMER_OWNER', rule: slaRule });
    }
  }

  // 2. Lost before → prefer the previous sales if they can take it now.
  if (settings['assignment.preferPreviousOwner']) {
    const prev = await tx.lead.findFirst({
      where: { customerId: lead.customerId, id: { not: lead.id }, status: 'LOST', ownerId: { not: null }, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { ownerId: true },
    });
    if (prev?.ownerId && !exclude.has(prev.ownerId)) {
      const facts = (await loadCandidateFacts(tx, lead.orgId, [prev.ownerId], now)).get(prev.ownerId);
      if (facts && !ineligibleReason(facts, exclude)) {
        return assign(tx, ctx, lead, { userId: prev.ownerId, method: 'PREVIOUS_OWNER', rule: slaRule });
      }
    }
  }

  // 3. Rules in priority order.
  for (const candidateRule of matching) {
    if (candidateRule.method === 'MANUAL') return queueLead(tx, ctx, lead, 'MANUAL_RULE');
    await lockKey(tx, `assignment-rule:${candidateRule.id}`);
    const rule = await tx.assignmentRule.findUniqueOrThrow({ where: { id: candidateRule.id } });
    const targets = rule.targetUserIds.length ? rule.targetUserIds : await defaultTargets(tx, lead.orgId);
    const facts = await loadCandidateFacts(tx, lead.orgId, targets, now);
    const eligible = new Set(targets.filter((id) => facts.has(id) && !ineligibleReason(facts.get(id)!, exclude)));

    let userId: string | null = null;
    if (rule.method === 'WEIGHTED') {
      const r = pickWeighted(targets, rule.weightState as WeightState | null, eligible);
      if (r) {
        userId = r.userId;
        await tx.assignmentRule.update({ where: { id: rule.id }, data: { weightState: r.state as unknown as Prisma.InputJsonValue } });
      }
    } else if (rule.method === 'LEAST_LOADED') {
      userId = pickLeastLoaded(targets, new Map([...facts].map(([id, f]) => [id, f.openLeads])), eligible)?.userId ?? null;
    } else {
      const r = pickRoundRobin(targets, rule.rrCursor, eligible);
      if (r) {
        userId = r.userId;
        await tx.assignmentRule.update({ where: { id: rule.id }, data: { rrCursor: r.state } });
      }
    }
    if (userId) return assign(tx, ctx, lead, { userId, method: rule.method, rule });
    if (rule.fallback === 'QUEUE') return queueLead(tx, ctx, lead, 'NO_CANDIDATE');
  }
  return queueLead(tx, ctx, lead, matching.length ? 'NO_CANDIDATE' : 'NO_RULE');
}

async function run<T>(db: Db, ctx: EngineContext, fx: Effects, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await db.$transaction(fn, TX_OPTIONS);
  await ctx.fx.flush(fx);
  return result;
}

export async function routeLead(db: Db, fx: Effects, actor: Actor, leadId: string, opts: RouteOptions = {}): Promise<RouteOutcome> {
  const ctx = await engineContext(db, actor);
  return run(db, ctx, fx, (tx) => routeLeadTx(tx, ctx, leadId, opts));
}

// ---------------------------------------------------------------- accept / return / expire

async function loadLead(tx: Tx, orgId: string, leadId: string): Promise<LeadWithCustomer> {
  const lead = await tx.lead.findFirst({ where: { id: leadId, orgId, deletedAt: null }, include: { customer: true } });
  if (!lead) throw new NotFoundError('Không tìm thấy lead');
  return lead;
}

/** Sales accepts a pending lead (button "Nhận" / bot NHAN). */
export async function acceptLead(db: Db, fx: Effects, actor: Actor, leadId: string) {
  const user = actor.user;
  if (!user) throw new DomainError('UNAUTHENTICATED', 'Cần đăng nhập', 401);
  const ctx = await engineContext(db, actor);
  return run(db, ctx, fx, async (tx) => {
    const lead = await loadLead(tx, actor.orgId, leadId);
    const a = await tx.leadAssignment.findFirst({ where: { leadId, userId: user.id, status: 'PENDING' }, include: { rule: true } });
    if (!a) throw new ConflictError('NOT_PENDING', 'Lead này không còn chờ bạn nhận');
    if (a.acceptDeadline && a.acceptDeadline < ctx.now) throw new ConflictError('ACCEPT_EXPIRED', 'Đã quá hạn nhận lead này');
    const updated = await tx.leadAssignment.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'ACCEPTED', respondedAt: ctx.now } });
    if (updated.count !== 1) throw new ConflictError('NOT_PENDING', 'Lead này không còn chờ bạn nhận');

    const contactMinutes = a.rule?.firstContactSlaMinutes ?? DEFAULT_SLA.firstContactSlaMinutes;
    const firstContactDeadline = lead.firstContactAt ? null : addBusinessMinutes(ctx.calendar, ctx.now, contactMinutes);
    await tx.lead.update({ where: { id: lead.id }, data: { status: 'IN_PROGRESS', acceptedAt: ctx.now, firstContactDeadline } });
    await tx.activity.create({
      data: { orgId: lead.orgId, customerId: lead.customerId, leadId: lead.id, userId: user.id, type: 'ASSIGNMENT', data: { action: 'ACCEPTED' }, createdAt: ctx.now },
    });
    await recordAudit(tx, {
      orgId: lead.orgId,
      actorId: user.id,
      via: actor.via,
      action: 'lead.accept',
      entityType: 'Lead',
      entityId: lead.id,
      before: { status: lead.status },
      after: { status: 'IN_PROGRESS', assignmentId: a.id },
      ip: actor.ip,
    });
    ctx.fx.publish({ type: 'lead.updated', orgId: lead.orgId, userIds: [user.id], roles: MANAGER_ROLES, data: { leadId, status: 'IN_PROGRESS' } });
    return { leadId, status: 'IN_PROGRESS' as const, firstContactDeadline };
  });
}

async function rerouteAfterDecline(tx: Tx, ctx: EngineContext, lead: LeadWithCustomer, maxReassign: number): Promise<RouteOutcome> {
  const count = lead.reassignCount + 1;
  await tx.lead.update({ where: { id: lead.id }, data: { reassignCount: count, ownerId: null, acceptedAt: null, firstContactDeadline: null } });
  const fresh = { ...lead, reassignCount: count };
  // SPEC 6.3.1: thu hồi tối đa `maxReassign` lần; vượt quá → hàng chờ + báo Owner.
  if (count > maxReassign) return queueLead(tx, ctx, fresh, 'MAX_REASSIGN');
  return routeLeadTx(tx, ctx, lead.id, { ignoreHold: true });
}

/** Sales gives a lead back (button "Trả lại" / bot TRA) → next sales in rotation. */
export async function returnLead(db: Db, fx: Effects, actor: Actor, leadId: string, reason?: string | null) {
  const user = actor.user;
  if (!user) throw new DomainError('UNAUTHENTICATED', 'Cần đăng nhập', 401);
  const ctx = await engineContext(db, actor);
  return run(db, ctx, fx, async (tx) => {
    const lead = await loadLead(tx, actor.orgId, leadId);
    assertAuthorized(user, 'lead.return', lead);
    const a = await tx.leadAssignment.findFirst({
      where: { leadId, userId: user.id, status: { in: ['PENDING', 'ACCEPTED'] } },
      include: { rule: true },
    });
    if (!a) throw new ConflictError('NOT_ASSIGNED', 'Bạn không đang giữ lead này');
    await tx.leadAssignment.update({ where: { id: a.id }, data: { status: 'RETURNED', respondedAt: ctx.now, returnReason: reason ?? null } });
    await tx.activity.create({
      data: {
        orgId: lead.orgId,
        customerId: lead.customerId,
        leadId: lead.id,
        userId: user.id,
        type: 'ASSIGNMENT',
        data: { action: 'RETURNED', reason: reason ?? null },
        createdAt: ctx.now,
      },
    });
    await recordAudit(tx, {
      orgId: lead.orgId,
      actorId: user.id,
      via: actor.via,
      action: 'lead.return',
      entityType: 'Lead',
      entityId: lead.id,
      before: { ownerId: lead.ownerId, status: lead.status },
      after: { returnedBy: user.id, reason: reason ?? null },
      ip: actor.ip,
    });
    return rerouteAfterDecline(tx, ctx, lead, a.rule?.maxReassign ?? DEFAULT_SLA.maxReassign);
  });
}

/** Delayed `sla-check` job and the `sla-sweeper` safety net. Idempotent. */
export async function expireAssignment(db: Db, fx: Effects, assignmentId: string, now = new Date()) {
  const a0 = await db.leadAssignment.findUnique({ where: { id: assignmentId }, select: { lead: { select: { orgId: true } } } });
  if (!a0) return { skipped: true as const };
  const ctx = await engineContext(db, systemActor(a0.lead.orgId), now);
  return run(db, ctx, fx, async (tx) => {
    const a = await tx.leadAssignment.findUnique({ where: { id: assignmentId }, include: { rule: true } });
    if (!a || a.status !== 'PENDING' || !a.acceptDeadline || a.acceptDeadline > now) return { skipped: true as const };
    const done = await tx.leadAssignment.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'EXPIRED', respondedAt: now } });
    if (done.count !== 1) return { skipped: true as const };
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: a.leadId }, include: { customer: true } });

    await tx.activity.create({
      data: { orgId: lead.orgId, customerId: lead.customerId, leadId: lead.id, type: 'ASSIGNMENT', data: { action: 'EXPIRED', fromUserId: a.userId }, createdAt: now },
    });
    await recordAudit(tx, {
      orgId: lead.orgId,
      via: 'SYSTEM',
      action: 'lead.expire',
      entityType: 'Lead',
      entityId: lead.id,
      before: { ownerId: lead.ownerId, status: lead.status, assignmentId: a.id },
      after: { expired: a.userId },
    });
    await notifyUsers(tx, ctx.fx, lead.orgId, [a.userId], {
      type: 'lead.reclaimed',
      title: `↩️ Lead #${lead.code} đã chuyển cho người khác`,
      body: 'Lead bị thu hồi do quá hạn nhận.',
      link: `/leads/${lead.id}`,
    });
    const outcome = await rerouteAfterDecline(tx, ctx, lead, a.rule?.maxReassign ?? DEFAULT_SLA.maxReassign);
    return { skipped: false as const, outcome };
  });
}

/** "Sắp hết hạn nhận" warning, a few minutes before the deadline. */
export async function warnExpiring(db: Db, fx: Effects, assignmentId: string) {
  const a = await db.leadAssignment.findUnique({ where: { id: assignmentId }, include: { lead: true } });
  if (!a || a.status !== 'PENDING' || !a.acceptDeadline) return false;
  const buf = new EffectBuffer();
  const minutes = Math.max(1, Math.round((a.acceptDeadline.getTime() - Date.now()) / 60_000));
  await db.$transaction((tx) =>
    notifyUsers(tx, buf, a.lead.orgId, [a.userId], {
      type: 'lead.expiring',
      title: `⏰ Còn ${minutes} phút để nhận lead #${a.lead.code}`,
      body: 'Bấm Nhận để giữ lead, nếu không lead sẽ chuyển cho người khác.',
      link: `/leads/${a.leadId}`,
    }),
  );
  buf.publish({ type: 'assignment.expiring', orgId: a.lead.orgId, userIds: [a.userId], data: { leadId: a.leadId, acceptDeadline: a.acceptDeadline.toISOString() } });
  await buf.flush(fx);
  return true;
}

// ---------------------------------------------------------------- manual

export type ManualTarget = { userId: string } | { auto: true };

/** Owner/Manager assigns or transfers leads (SPEC 6.3.5). `auto` re-runs the rules. */
export async function assignLeads(db: Db, fx: Effects, actor: Actor, leadIds: readonly string[], target: ManualTarget) {
  const user = actor.user;
  if (!user) throw new DomainError('UNAUTHENTICATED', 'Cần đăng nhập', 401);
  assertAuthorized(user, leadIds.length > 1 ? 'lead.bulkAssign' : 'lead.assign');
  if ('userId' in target) {
    const assignee = await db.user.findFirst({ where: { id: target.userId, orgId: actor.orgId, deletedAt: null, status: { not: 'INACTIVE' } } });
    if (!assignee) throw new DomainError('INVALID_ASSIGNEE', 'Người nhận không hợp lệ hoặc đã nghỉ việc', 422);
    if (assignee.role === 'SUPPORT' || assignee.role === 'VIEWER') throw new DomainError('INVALID_ASSIGNEE', 'Chỉ giao lead cho sales hoặc quản lý', 422);
  }
  const results: { leadId: string; outcome?: RouteOutcome; error?: string }[] = [];
  for (const leadId of leadIds) {
    const ctx = await engineContext(db, actor);
    try {
      const outcome = await run(db, ctx, fx, async (tx) => {
        const lead = await loadLead(tx, actor.orgId, leadId);
        if (lead.status === 'WON' || lead.status === 'LOST') throw new ConflictError('LEAD_CLOSED', 'Lead đã đóng');
        if ('auto' in target) {
          await tx.leadAssignment.updateMany({ where: { leadId, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'REASSIGNED', respondedAt: ctx.now } });
          return routeLeadTx(tx, ctx, leadId, { ignoreHold: true });
        }
        if (lead.ownerId === target.userId && lead.status === 'IN_PROGRESS') {
          return { kind: 'ASSIGNED', assignmentId: '', userId: target.userId, userName: '', method: 'MANUAL', acceptDeadline: null } as RouteOutcome;
        }
        const method: AssignmentMethod = lead.ownerId ? 'TRANSFER' : 'MANUAL';
        return assign(tx, ctx, lead, { userId: target.userId, method, rule: null, assignedById: user.id, accepted: true });
      });
      results.push({ leadId, outcome });
    } catch (err) {
      if (leadIds.length === 1) throw err;
      results.push({ leadId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** Assign inside an existing transaction (used by intake: SALES self-assign, import "giao cho 1 người"). */
export async function assignDirectTx(tx: Tx, ctx: EngineContext, leadId: string, userId: string, opts: { accepted: boolean }) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { customer: true } });
  return assign(tx, ctx, lead, { userId, method: 'MANUAL', rule: null, assignedById: ctx.actor.user?.id ?? null, accepted: opts.accepted });
}

export async function queueLeadTx(tx: Tx, ctx: EngineContext, leadId: string, reason: QueueReason) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { customer: true } });
  return queueLead(tx, ctx, lead, reason);
}

// ---------------------------------------------------------------- jobs

/** `sla-sweeper` (every minute): expire overdue PENDING assignments, flag overdue first contacts. */
export async function sweepSla(db: Db, fx: Effects, now = new Date(), scope: { orgId?: string } = {}) {
  const overdue = await db.leadAssignment.findMany({
    where: { status: 'PENDING', acceptDeadline: { lte: now }, ...(scope.orgId ? { lead: { orgId: scope.orgId } } : {}) },
    select: { id: true },
    orderBy: { acceptDeadline: 'asc' },
    take: 200,
  });
  let expired = 0;
  for (const a of overdue) if (!(await expireAssignment(db, fx, a.id, now)).skipped) expired++;

  const lateContact = await db.lead.findMany({
    where: {
      ...(scope.orgId ? { orgId: scope.orgId } : {}),
      status: 'IN_PROGRESS',
      deletedAt: null,
      firstContactAt: null,
      firstContactDeadline: { lte: now },
      activities: { none: { type: 'SYSTEM', data: { path: ['kind'], equals: 'CONTACT_OVERDUE' } } },
    },
    include: { customer: true },
    take: 200,
  });
  for (const lead of lateContact) await flagContactOverdue(db, fx, lead, now);
  return { expired, contactOverdue: lateContact.length };
}

async function flagContactOverdue(db: Db, fx: Effects, lead: LeadWithCustomer, now: Date) {
  const ctx = await engineContext(db, systemActor(lead.orgId), now);
  await run(db, ctx, fx, async (tx) => {
    await tx.activity.create({
      data: { orgId: lead.orgId, customerId: lead.customerId, leadId: lead.id, type: 'SYSTEM', data: { kind: 'CONTACT_OVERDUE', ownerId: lead.ownerId }, createdAt: now },
    });
    const d = describeLead(lead);
    await notifyUsers(tx, ctx.fx, lead.orgId, [...(lead.ownerId ? [lead.ownerId] : []), ...(await managerIds(tx, lead.orgId))], {
      type: 'lead.contactOverdue',
      title: `⏰ ${d.title} quá hạn liên hệ đầu tiên`,
      body: 'Sales đã nhận nhưng chưa ghi nhận cuộc gọi/tin nhắn đầu tiên.',
      link: `/leads/${lead.id}`,
    });
    if (ctx.settings['assignment.reclaimOnContactSlaBreach'] && lead.ownerId) {
      const a = await tx.leadAssignment.findFirst({ where: { leadId: lead.id, status: 'ACCEPTED' }, include: { rule: true } });
      if (a) {
        await tx.leadAssignment.update({ where: { id: a.id }, data: { status: 'EXPIRED', respondedAt: now } });
        await rerouteAfterDecline(tx, ctx, lead, a.rule?.maxReassign ?? DEFAULT_SLA.maxReassign);
      }
    }
  });
}

/** `out-of-hours-release` (08:00 T2–T7): route leads held under outOfHoursMode = HOLD. */
export async function releaseHeldLeads(db: Db, fx: Effects, orgId: string, now = new Date()) {
  const calendar = await loadCalendar(db, orgId);
  if (!isBusinessTime(calendar, now)) return { released: 0 };
  const held = await db.lead.findMany({ where: { orgId, status: 'NEW', deletedAt: null }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  for (const l of held) await routeLead(db, fx, systemActor(orgId), l.id, { ignoreHold: true });
  return { released: held.length };
}
