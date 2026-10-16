// Lead assignment engine (SPEC 6.3). All picks run inside a transaction holding
// pg_advisory_xact_lock(hash(rule.id)), so concurrent leads advance the round-robin cursor one by one.
import { assertAuthorized } from '@michio/auth';
import type { AssignmentMethod, AssignmentRule, Lead, Prisma } from '@michio/db';
import { formatDateTime, INTEREST_CATEGORY_LABELS, LEAD_SOURCE_LABELS, maskPhone, ORDER_BAND_LABELS } from '@michio/shared';
import { recordAudit } from './audit';
import { addBusinessMinutes, type BusinessCalendar, isBusinessTime } from './business-time';
import { loadCalendar } from './calendar';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';
import { managerIds, notifyUsers } from './notifications';
import { ruleMatches } from './rules';
import { getSettings } from './settings';

type Tx = Prisma.TransactionClient;

export const OPEN_LEAD_STATUSES = ['NEW', 'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS'] as const;
/** Leads that count towards a salesperson's `maxOpenLeads`. */
const LOAD_STATUSES = ['ASSIGNED', 'IN_PROGRESS'] as const;

/** SLA values used when an assignment is not driven by a rule (customer owner, manual). */
const DEFAULT_SLA = { acceptSlaMinutes: 10, hotAcceptSlaMinutes: 5, firstContactSlaMinutes: 30, maxReassign: 3, autoAccept: false };
type SlaSource = Pick<AssignmentRule, 'acceptSlaMinutes' | 'hotAcceptSlaMinutes' | 'firstContactSlaMinutes' | 'maxReassign' | 'autoAccept'>;

export type AssignOutcome =
  | { status: 'ASSIGNED'; assignmentId: string; userId: string; userName: string; method: AssignmentMethod; acceptDeadline: Date | null }
  | { status: 'QUEUED'; reason: string }
  | { status: 'HELD' }
  | { status: 'SKIPPED'; reason: string };

export interface AssignOptions {
  /** Route straight to this user (customer owner / previous owner) when eligible, else fall back to rules. */
  preferred?: { userId: string; method: 'CUSTOMER_OWNER' | 'PREVIOUS_OWNER'; requireAvailable: boolean };
  /** Ignore `outOfHoursMode = HOLD` (used by the 08:00 release job and re-assignments). */
  ignoreHold?: boolean;
}

type LeadWithCustomer = Lead & { customer: { id: string; contactName: string; phone: string | null; shopName: string | null; province: string | null; businessModel: string | null; expectedOrderBand: string | null; interestCategories: string[]; tags: string[]; orderCount: number } };

async function deadline(now: Date, minutes: number, cal: BusinessCalendar, businessHoursOnly: boolean) {
  return businessHoursOnly ? addBusinessMinutes(now, minutes, cal) : new Date(now.getTime() + minutes * 60_000);
}

/**
 * Candidate filter (SPEC 6.3.3): AVAILABLE, not on leave, below maxOpenLeads, and never
 * returned/expired this lead before. Returns eligible ids with their current load.
 */
async function eligibleCandidates(tx: Tx, orgId: string, userIds: string[], leadId: string, now: Date, requireAvailable = true) {
  if (!userIds.length) return new Map<string, number>();
  const [users, leaves, prior, loads] = await Promise.all([
    tx.user.findMany({
      where: { id: { in: userIds }, orgId, deletedAt: null, status: requireAvailable ? 'AVAILABLE' : { in: ['AVAILABLE', 'BUSY'] } },
      select: { id: true, maxOpenLeads: true },
    }),
    tx.userLeave.findMany({ where: { userId: { in: userIds }, startAt: { lte: now }, endAt: { gt: now } }, select: { userId: true } }),
    tx.leadAssignment.findMany({ where: { leadId, status: { in: ['RETURNED', 'EXPIRED'] } }, select: { userId: true } }),
    tx.lead.groupBy({ by: ['ownerId'], where: { orgId, ownerId: { in: userIds }, status: { in: [...LOAD_STATUSES] }, deletedAt: null }, _count: true }),
  ]);
  const excluded = new Set([...leaves.map((l) => l.userId), ...prior.map((p) => p.userId)]);
  const loadOf = new Map(loads.map((l) => [l.ownerId as string, l._count]));
  const out = new Map<string, number>();
  for (const u of users) {
    const load = loadOf.get(u.id) ?? 0;
    if (!excluded.has(u.id) && load < u.maxOpenLeads) out.set(u.id, load);
  }
  return out;
}

/** Chooses a user and returns the rule fields to persist (cursor / weights). Pure. */
export function pickAssignee(
  rule: Pick<AssignmentRule, 'method' | 'targetUserIds' | 'rrCursor' | 'weightState'>,
  eligible: Map<string, number>,
  weights: Record<string, number> = {},
): { userId: string; update: { rrCursor?: number; weightState?: Record<string, number> } } | null {
  const targets = rule.targetUserIds;
  const n = targets.length;
  if (!n || !eligible.size) return null;

  if (rule.method === 'WEIGHTED') {
    // Smooth weighted round-robin (nginx style): deterministic and fair over time.
    const state = { ...((rule.weightState as Record<string, number> | null) ?? {}) };
    let best: string | null = null;
    let total = 0;
    for (const id of targets) {
      if (!eligible.has(id)) continue;
      const w = Math.max(1, weights[id] ?? 1);
      total += w;
      state[id] = (state[id] ?? 0) + w;
      if (best === null || (state[id] as number) > (state[best] as number)) best = id;
    }
    if (!best) return null;
    state[best] = (state[best] as number) - total;
    return { userId: best, update: { weightState: state } };
  }

  // ROUND_ROBIN walks from the cursor; LEAST_LOADED takes the lowest load, ties broken by the same walk.
  let chosen: { idx: number; id: string } | null = null;
  for (let k = 0; k < n; k++) {
    const idx = (((rule.rrCursor % n) + n) % n + k) % n;
    const id = targets[idx] as string;
    if (!eligible.has(id)) continue;
    if (rule.method !== 'LEAST_LOADED') {
      chosen = { idx, id };
      break;
    }
    if (!chosen || (eligible.get(id) as number) < (eligible.get(chosen.id) as number)) chosen = { idx, id };
  }
  if (!chosen) return null;
  return { userId: chosen.id, update: { rrCursor: (chosen.idx + 1) % n } };
}

async function teamWeights(tx: Tx, userIds: string[]): Promise<Record<string, number>> {
  const rows = await tx.teamMember.findMany({ where: { userId: { in: userIds } }, select: { userId: true, weight: true } });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.userId] = Math.max(out[r.userId] ?? 0, r.weight);
  return out;
}

interface CreateArgs {
  ctx: ServiceContext;
  outbox: Outbox;
  lead: LeadWithCustomer;
  userId: string;
  method: AssignmentMethod;
  rule: (SlaSource & { id: string }) | null;
  cal: BusinessCalendar;
  businessHoursOnly: boolean;
  /** Manual assignments skip the accept step. */
  accepted?: boolean;
}

async function createAssignment(tx: Tx, a: CreateArgs): Promise<Extract<AssignOutcome, { status: 'ASSIGNED' }>> {
  const { ctx, outbox, lead, userId, method, rule } = a;
  const now = ctx.now();
  const sla = rule ?? DEFAULT_SLA;
  const accepted = a.accepted || sla.autoAccept;
  const acceptMinutes = lead.priority === 'HOT' ? sla.hotAcceptSlaMinutes : sla.acceptSlaMinutes;
  const acceptDeadline = accepted ? null : await deadline(now, acceptMinutes, a.cal, a.businessHoursOnly);
  const firstContactDeadline =
    accepted && !lead.firstContactAt ? await deadline(now, sla.firstContactSlaMinutes, a.cal, a.businessHoursOnly) : null;

  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
  const assignment = await tx.leadAssignment.create({
    data: {
      leadId: lead.id,
      userId,
      ruleId: rule?.id ?? null,
      method,
      status: accepted ? 'ACCEPTED' : 'PENDING',
      assignedById: ctx.actor?.id ?? null,
      acceptDeadline,
      respondedAt: accepted ? now : null,
    },
  });
  await tx.lead.update({
    where: { id: lead.id },
    data: {
      ownerId: userId,
      status: accepted ? 'IN_PROGRESS' : 'ASSIGNED',
      firstAssignedAt: lead.firstAssignedAt ?? now,
      acceptedAt: accepted ? now : null,
      firstContactDeadline: firstContactDeadline ?? lead.firstContactDeadline,
      lastActivityAt: now,
    },
  });
  // A prospect follows its lead owner; once it has orders the owner is sticky (SPEC 6.7, 6.10).
  if (lead.customer.orderCount === 0) await tx.customer.update({ where: { id: lead.customerId }, data: { ownerId: userId } });

  await tx.activity.create({
    data: {
      orgId: lead.orgId,
      customerId: lead.customerId,
      leadId: lead.id,
      userId: ctx.actor?.id ?? null,
      type: 'ASSIGNMENT',
      data: { toUserId: userId, toUserName: user.fullName, method, ruleId: rule?.id ?? null, acceptDeadline: acceptDeadline?.toISOString() ?? null },
      createdAt: now,
    },
  });
  await recordAudit(tx, {
    orgId: lead.orgId,
    actorId: ctx.actor?.id ?? null,
    via: ctx.via,
    action: 'lead.assign',
    entityType: 'Lead',
    entityId: lead.id,
    before: { ownerId: lead.ownerId, status: lead.status },
    after: { ownerId: userId, status: accepted ? 'IN_PROGRESS' : 'ASSIGNED', method, assignmentId: assignment.id },
    ip: ctx.ip,
  });

  const c = lead.customer;
  await notifyUsers(tx, outbox, lead.orgId, [userId], {
    type: 'lead.assigned',
    // SPEC 5.5 template: "🔔 Lead #1234 · Chị Hoa · 0912xxx678 · Shop… – Hải Phòng · Mức nhập 10–30tr ·
    // Quan tâm: … · Nguồn: Form sỉ. Nhận trước 14:35 → NHAN 1234 / TRA 1234" (also shown in the bell).
    title: `🔔 Lead #${lead.code} · ${c.contactName}${c.phone ? ` · ${maskPhone(c.phone)}` : ''}`,
    body: [
      [
        c.shopName && `${c.shopName}${c.province ? ` – ${c.province}` : ''}`,
        c.expectedOrderBand && c.expectedOrderBand !== 'UNKNOWN' && `Mức nhập ${ORDER_BAND_LABELS[c.expectedOrderBand as keyof typeof ORDER_BAND_LABELS]}`,
        c.interestCategories.length && `Quan tâm: ${c.interestCategories.map((k) => INTEREST_CATEGORY_LABELS[k] ?? k).join(', ')}`,
        `Nguồn: ${LEAD_SOURCE_LABELS[lead.source]}`,
      ]
        .filter(Boolean)
        .join(' · '),
      acceptDeadline ? `Nhận trước ${formatDateTime(acceptDeadline)} → NHAN ${lead.code} / TRA ${lead.code}` : 'Đã giao trực tiếp cho bạn',
    ].join('. '),
    link: `/leads/${lead.id}`,
  });
  outbox.publish({
    type: 'lead.assigned',
    orgId: lead.orgId,
    audience: { userIds: [userId], roles: MANAGERS },
    data: { leadId: lead.id, code: lead.code, userId, acceptDeadline: acceptDeadline?.toISOString() ?? null },
  });
  if (acceptDeadline) outbox.scheduleSlaCheck(assignment.id, acceptDeadline);

  return { status: 'ASSIGNED', assignmentId: assignment.id, userId, userName: user.fullName, method, acceptDeadline };
}

async function queueLead(tx: Tx, ctx: ServiceContext, outbox: Outbox, lead: LeadWithCustomer, reason: string): Promise<AssignOutcome> {
  await tx.lead.update({ where: { id: lead.id }, data: { status: 'UNASSIGNED', ownerId: null } });
  await tx.activity.create({
    data: { orgId: lead.orgId, customerId: lead.customerId, leadId: lead.id, type: 'SYSTEM', data: { kind: 'queued', reason }, createdAt: ctx.now() },
  });
  await notifyUsers(tx, outbox, lead.orgId, await managerIds(tx, lead.orgId), {
    type: 'lead.queued',
    title: `⚠️ Lead #${lead.code} chưa có người nhận`,
    body: `${lead.customer.contactName} — ${reason}. Vui lòng giao tay.`,
    link: `/leads/${lead.id}`,
  });
  outbox.publish({ type: 'lead.updated', orgId: lead.orgId, audience: { roles: MANAGERS }, data: { leadId: lead.id, status: 'UNASSIGNED' } });
  return { status: 'QUEUED', reason };
}

const loadLead = (tx: Tx, id: string) =>
  tx.lead.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, contactName: true, phone: true, shopName: true, province: true, businessModel: true, expectedOrderBand: true, interestCategories: true, tags: true, orderCount: true },
      },
    },
  });

/** onLeadCreated / re-assignment after return or expiry (SPEC 6.3.4). */
export async function assignLead(ctx: ServiceContext, leadId: string, opts: AssignOptions = {}): Promise<AssignOutcome> {
  const outbox = new Outbox(ctx.effects);
  const result = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const lead = await loadLead(tx, leadId);
    if (!lead || lead.deletedAt) return { status: 'SKIPPED', reason: 'not found' } as const;
    if (lead.status !== 'NEW' && lead.status !== 'UNASSIGNED') return { status: 'SKIPPED', reason: `status ${lead.status}` } as const;

    const cal = await loadCalendar(tx, ctx.orgId);
    const settings = await getSettings(tx, ctx.orgId, ['sla.businessHoursOnly', 'assignment.outOfHoursMode']);
    const businessHoursOnly = settings['sla.businessHoursOnly'];
    const inHours = isBusinessTime(now, cal);
    if (!opts.ignoreHold && settings['assignment.outOfHoursMode'] === 'HOLD' && !inHours) return { status: 'HELD' } as const;

    const rules = await tx.assignmentRule.findMany({ where: { orgId: ctx.orgId, isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    const defaultRule = rules[rules.length - 1] ?? null;

    if (opts.preferred) {
      const ok = await eligibleCandidates(tx, ctx.orgId, [opts.preferred.userId], lead.id, now, opts.preferred.requireAvailable);
      if (ok.size) {
        return createAssignment(tx, { ctx, outbox, lead, userId: opts.preferred.userId, method: opts.preferred.method, rule: defaultRule, cal, businessHoursOnly });
      }
    }

    const facts = {
      source: lead.source,
      businessModel: lead.customer.businessModel,
      orderBand: lead.customer.expectedOrderBand,
      interestCategories: lead.customer.interestCategories,
      province: lead.customer.province,
      tags: lead.customer.tags,
      inBusinessHours: inHours,
    };
    for (const rule of rules) {
      if (!ruleMatches(rule.conditions, facts)) continue;
      if (rule.method === 'MANUAL') return queueLead(tx, ctx, outbox, lead, `Luật "${rule.name}" yêu cầu giao tay`);

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rule.id}))`;
      const fresh = await tx.assignmentRule.findUniqueOrThrow({ where: { id: rule.id } }); // cursor as of the lock
      const eligible = await eligibleCandidates(tx, ctx.orgId, fresh.targetUserIds, lead.id, now);
      const weights = fresh.method === 'WEIGHTED' ? await teamWeights(tx, fresh.targetUserIds) : {};
      const picked = pickAssignee(fresh, eligible, weights);
      if (!picked) {
        if (fresh.fallback === 'NEXT_RULE') continue;
        return queueLead(tx, ctx, outbox, lead, 'Không còn sales phù hợp (nghỉ, bận, đủ tải hoặc đã trả lead)');
      }
      await tx.assignmentRule.update({
        where: { id: fresh.id },
        data: { rrCursor: picked.update.rrCursor, weightState: picked.update.weightState },
      });
      return createAssignment(tx, { ctx, outbox, lead, userId: picked.userId, method: fresh.method, rule: fresh, cal, businessHoursOnly });
    }
    return queueLead(tx, ctx, outbox, lead, 'Không có luật chia nào phù hợp');
  }, TX_OPTIONS);
  await outbox.flush();
  return result;
}

/** Shared tail of return / expiry: lead goes back to the pool, then either queue or re-assign. */
async function releaseAndReroute(
  ctx: ServiceContext,
  args: { assignmentId: string; status: 'RETURNED' | 'EXPIRED'; reason?: string; action: string },
): Promise<AssignOutcome> {
  const outbox = new Outbox(ctx.effects);
  const step = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const a = await tx.leadAssignment.findUnique({ where: { id: args.assignmentId }, include: { rule: true } });
    if (!a) throw notFound('lượt giao');
    const lead = await loadLead(tx, a.leadId);
    if (!lead) throw notFound('lead');

    const reassignCount = lead.reassignCount + 1;
    await tx.leadAssignment.update({ where: { id: a.id }, data: { status: args.status, respondedAt: now, returnReason: args.reason ?? null } });
    await tx.lead.update({ where: { id: lead.id }, data: { status: 'UNASSIGNED', ownerId: null, reassignCount, acceptedAt: null } });
    await tx.activity.create({
      data: {
        orgId: lead.orgId,
        customerId: lead.customerId,
        leadId: lead.id,
        userId: ctx.actor?.id ?? null,
        type: 'ASSIGNMENT',
        data: { kind: args.status === 'RETURNED' ? 'returned' : 'expired', fromUserId: a.userId, reason: args.reason ?? null },
        createdAt: now,
      },
    });
    await recordAudit(tx, {
      orgId: lead.orgId,
      actorId: ctx.actor?.id ?? null,
      via: ctx.via,
      action: args.action,
      entityType: 'Lead',
      entityId: lead.id,
      before: { ownerId: a.userId, assignmentStatus: a.status },
      after: { ownerId: null, assignmentStatus: args.status, reassignCount },
      ip: ctx.ip,
    });
    if (args.status === 'EXPIRED') {
      await notifyUsers(tx, outbox, lead.orgId, [a.userId], {
        type: 'lead.reclaimed',
        title: `↩️ Lead #${lead.code} đã chuyển cho người khác do quá hạn nhận.`,
        body: lead.customer.contactName,
        link: `/leads/${lead.id}`,
      });
    }
    const maxReassign = a.rule?.maxReassign ?? DEFAULT_SLA.maxReassign;
    if (reassignCount >= maxReassign) {
      const fresh = (await loadLead(tx, lead.id)) as LeadWithCustomer;
      const queued = await queueLead(tx, ctx, outbox, fresh, `Đã chuyển ${reassignCount} lần mà chưa ai nhận`);
      return { kind: 'queued' as const, queued };
    }
    return { kind: 'reroute' as const, leadId: lead.id };
  }, TX_OPTIONS);
  await outbox.flush();
  if (step.kind === 'queued') return step.queued;
  return assignLead(ctx, step.leadId, { ignoreHold: true });
}

/** sla-check job: PENDING past its deadline → EXPIRED and re-routed (SPEC 6.3.4 onSlaCheck). */
export async function expireAssignment(ctx: ServiceContext, assignmentId: string): Promise<AssignOutcome> {
  const a = await ctx.db.leadAssignment.findUnique({ where: { id: assignmentId } });
  if (!a || a.status !== 'PENDING' || !a.acceptDeadline || a.acceptDeadline > ctx.now()) {
    return { status: 'SKIPPED', reason: 'not due' };
  }
  // Claim atomically so the delayed job and the sweeper cannot both expire it.
  const claimed = await ctx.db.leadAssignment.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
  if (!claimed.count) return { status: 'SKIPPED', reason: 'already handled' };
  return releaseAndReroute(ctx, { assignmentId, status: 'EXPIRED', action: 'lead.assignment_expired' });
}

function requireActor(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

async function currentAssignment(ctx: ServiceContext, leadId: string) {
  return ctx.db.leadAssignment.findFirst({
    where: { leadId, status: { in: ['PENDING', 'ACCEPTED'] } },
    orderBy: { createdAt: 'desc' },
    include: { rule: true, lead: true },
  });
}

/** NHAN — the assignee accepts (SPEC 6.3.4 onAccept). */
export async function acceptLead(ctx: ServiceContext, leadId: string) {
  const actor = requireActor(ctx);
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const a = await tx.leadAssignment.findFirst({ where: { leadId, userId: actor.id, status: 'PENDING' }, include: { rule: true, lead: true } });
    if (!a || a.lead.orgId !== ctx.orgId) throw new DomainError('INVALID_STATE', 'Lead này không còn chờ bạn nhận');
    if (a.acceptDeadline && a.acceptDeadline <= now) throw new DomainError('INVALID_STATE', 'Đã quá hạn nhận lead này');
    const cal = await loadCalendar(tx, ctx.orgId);
    const { 'sla.businessHoursOnly': bho } = await getSettings(tx, ctx.orgId, ['sla.businessHoursOnly']);
    const firstContactDeadline = a.lead.firstContactAt
      ? null
      : await deadline(now, a.rule?.firstContactSlaMinutes ?? DEFAULT_SLA.firstContactSlaMinutes, cal, bho);

    await tx.leadAssignment.update({ where: { id: a.id }, data: { status: 'ACCEPTED', respondedAt: now } });
    const lead = await tx.lead.update({
      where: { id: leadId },
      data: { status: 'IN_PROGRESS', acceptedAt: now, firstContactDeadline, lastActivityAt: now },
    });
    await tx.activity.create({
      data: { orgId: ctx.orgId, customerId: lead.customerId, leadId, userId: actor.id, type: 'ASSIGNMENT', data: { kind: 'accepted' }, createdAt: now },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'lead.accept', entityType: 'Lead', entityId: leadId,
      before: { status: a.lead.status }, after: { status: 'IN_PROGRESS', firstContactDeadline: firstContactDeadline?.toISOString() ?? null }, ip: ctx.ip,
    });
    outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: [actor.id], roles: MANAGERS }, data: { leadId, status: 'IN_PROGRESS' } });
    return { leadId, firstContactDeadline };
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

/** TRA — the assignee hands the lead back; it is re-routed to someone else (SPEC 6.3.4 onReturn). */
export async function returnLead(ctx: ServiceContext, leadId: string, reason?: string) {
  const actor = requireActor(ctx);
  const a = await currentAssignment(ctx, leadId);
  if (!a || a.lead.orgId !== ctx.orgId) throw new DomainError('INVALID_STATE', 'Lead này hiện không do bạn phụ trách');
  assertAuthorized(actor, 'lead.return', { orgId: a.lead.orgId, ownerId: a.userId });
  const claimed = await ctx.db.leadAssignment.updateMany({ where: { id: a.id, status: a.status }, data: { status: 'RETURNED' } });
  if (!claimed.count) throw new DomainError('CONFLICT', 'Lead vừa được cập nhật, vui lòng tải lại');
  return releaseAndReroute(ctx, { assignmentId: a.id, status: 'RETURNED', reason, action: 'lead.return' });
}

/** Giao tay / chuyển (SPEC 6.3.5). Owner/Manager only; works for one or many leads. */
export async function manualAssign(ctx: ServiceContext, leadIds: string[], userId: string) {
  const actor = requireActor(ctx);
  assertAuthorized(actor, leadIds.length > 1 ? 'lead.bulkAssign' : 'lead.assign');
  return assignDirect(ctx, leadIds, userId);
}

/** Direct assignment without a permission check — callers must authorize (manual assign, self-assign on create). */
export async function assignDirect(ctx: ServiceContext, leadIds: string[], userId: string) {
  const target = await ctx.db.user.findFirst({ where: { id: userId, orgId: ctx.orgId, deletedAt: null, status: { not: 'INACTIVE' } } });
  if (!target) throw new DomainError('VALIDATION_ERROR', 'Người nhận không hợp lệ hoặc đã nghỉ việc');

  const results: { leadId: string; ok: boolean; error?: string }[] = [];
  for (const leadId of leadIds) {
    const outbox = new Outbox(ctx.effects);
    try {
      await ctx.db.$transaction(async (tx) => {
        const lead = await loadLead(tx, leadId);
        if (!lead || lead.orgId !== ctx.orgId || lead.deletedAt) throw notFound('lead');
        if (lead.status === 'WON' || lead.status === 'LOST') throw new DomainError('INVALID_STATE', 'Lead đã đóng');
        if (lead.ownerId === userId) return;
        await tx.leadAssignment.updateMany({ where: { leadId, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'REASSIGNED', respondedAt: ctx.now() } });
        const cal = await loadCalendar(tx, ctx.orgId);
        const { 'sla.businessHoursOnly': bho } = await getSettings(tx, ctx.orgId, ['sla.businessHoursOnly']);
        await createAssignment(tx, {
          ctx, outbox, lead, userId, method: lead.ownerId ? 'TRANSFER' : 'MANUAL', rule: null, cal, businessHoursOnly: bho, accepted: true,
        });
      }, TX_OPTIONS);
      await outbox.flush();
      results.push({ leadId, ok: true });
    } catch (err) {
      results.push({ leadId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** Re-routes leads still waiting for a user who just became unavailable for good (deactivation). */
export async function reclaimPendingForUser(ctx: ServiceContext, userId: string) {
  const pending = await ctx.db.leadAssignment.findMany({ where: { userId, status: 'PENDING', lead: { orgId: ctx.orgId } }, select: { id: true } });
  const out: AssignOutcome[] = [];
  for (const a of pending) {
    const claimed = await ctx.db.leadAssignment.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    if (claimed.count) out.push(await releaseAndReroute(ctx, { assignmentId: a.id, status: 'EXPIRED', reason: 'Người nhận đã nghỉ việc', action: 'lead.assignment_reclaimed' }));
  }
  return out;
}

/** sla-sweeper (every minute): safety net for missed delayed jobs + first-contact SLA warnings. */
export async function sweepSla(ctx: ServiceContext) {
  const now = ctx.now();
  const due = await ctx.db.leadAssignment.findMany({
    where: { status: 'PENDING', acceptDeadline: { lte: now }, lead: { orgId: ctx.orgId } },
    select: { id: true },
    take: 200,
  });
  let expired = 0;
  for (const a of due) if ((await expireAssignment(ctx, a.id)).status !== 'SKIPPED') expired++;

  const overdue = await ctx.db.lead.findMany({
    where: { orgId: ctx.orgId, status: 'IN_PROGRESS', firstContactAt: null, firstContactDeadline: { lte: now }, deletedAt: null },
    include: { customer: { select: { contactName: true } } },
    take: 200,
  });
  let warned = 0;
  for (const lead of overdue) {
    const link = `/leads/${lead.id}`;
    const already = await ctx.db.notification.findFirst({ where: { type: 'lead.contact_overdue', link } });
    if (already) continue;
    const outbox = new Outbox(ctx.effects);
    await ctx.db.$transaction(async (tx) => {
      await notifyUsers(tx, outbox, ctx.orgId, [lead.ownerId, ...(await managerIds(tx, ctx.orgId))].filter(Boolean) as string[], {
        type: 'lead.contact_overdue',
        title: `⏰ Lead #${lead.code} quá hạn liên hệ đầu tiên`,
        body: `${lead.customer.contactName} — hạn ${formatDateTime(lead.firstContactDeadline as Date)}`,
        link,
      });
    });
    await outbox.flush();
    warned++;
    const { 'assignment.reclaimOnContactSlaBreach': reclaim } = await getSettings(ctx.db, ctx.orgId, ['assignment.reclaimOnContactSlaBreach']);
    if (reclaim) {
      const a = await currentAssignment(ctx, lead.id);
      if (a) {
        const claimed = await ctx.db.leadAssignment.updateMany({ where: { id: a.id, status: 'ACCEPTED' }, data: { status: 'EXPIRED' } });
        if (claimed.count) await releaseAndReroute(ctx, { assignmentId: a.id, status: 'EXPIRED', action: 'lead.contact_sla_reclaim' });
      }
    }
  }
  return { expired, warned };
}

/** out-of-hours-release (08:00 T2–T7): assigns leads held by `outOfHoursMode = HOLD`. */
export async function releaseHeldLeads(ctx: ServiceContext) {
  const held = await ctx.db.lead.findMany({
    where: { orgId: ctx.orgId, status: 'NEW', deletedAt: null, assignments: { none: {} } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const out = [];
  for (const l of held) out.push(await assignLead(ctx, l.id, { ignoreHold: true }));
  return out;
}

/** "Thử luật" (SPEC 6.12): which rule matches and who would get the lead now, without side effects. */
export async function simulateAssignment(
  ctx: ServiceContext,
  facts: { source: string; businessModel?: string | null; orderBand?: string | null; interestCategories?: string[]; province?: string | null; tags?: string[] },
) {
  const now = ctx.now();
  const cal = await loadCalendar(ctx.db, ctx.orgId);
  const inBusinessHours = isBusinessTime(now, cal);
  const rules = await ctx.db.assignmentRule.findMany({ where: { orgId: ctx.orgId, isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  const trace: { ruleId: string; name: string; matched: boolean; eligible?: string[] }[] = [];
  for (const rule of rules) {
    const matched = ruleMatches(rule.conditions, { ...facts, inBusinessHours });
    if (!matched) {
      trace.push({ ruleId: rule.id, name: rule.name, matched });
      continue;
    }
    if (rule.method === 'MANUAL') return { trace: [...trace, { ruleId: rule.id, name: rule.name, matched }], result: { kind: 'QUEUE' as const, ruleName: rule.name } };
    const eligible = await eligibleCandidates(ctx.db as unknown as Tx, ctx.orgId, rule.targetUserIds, '__simulation__', now);
    const weights = rule.method === 'WEIGHTED' ? await teamWeights(ctx.db as unknown as Tx, rule.targetUserIds) : {};
    const picked = pickAssignee(rule, eligible, weights);
    trace.push({ ruleId: rule.id, name: rule.name, matched, eligible: [...eligible.keys()] });
    if (picked) {
      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: picked.userId }, select: { id: true, fullName: true } });
      const { 'priority.byOrderBand': byBand } = await getSettings(ctx.db, ctx.orgId, ['priority.byOrderBand']);
      const priority = byBand[(facts.orderBand ?? 'UNKNOWN') as keyof typeof byBand] ?? 'COLD';
      const sla = priority === 'HOT' ? rule.hotAcceptSlaMinutes : rule.acceptSlaMinutes;
      return { trace, result: { kind: 'ASSIGN' as const, ruleName: rule.name, user, priority, acceptDeadline: addBusinessMinutes(now, sla, cal), inBusinessHours } };
    }
    if (rule.fallback !== 'NEXT_RULE') return { trace, result: { kind: 'QUEUE' as const, ruleName: rule.name } };
  }
  return { trace, result: { kind: 'QUEUE' as const, ruleName: null } };
}
