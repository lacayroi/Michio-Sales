// Lead queries & edits (SPEC 6.2, §8 /leads). Writes are permission-checked and audited here.
import { assertAuthorized, type AuthUser, scopeFilter } from '@michio/auth';
import type { LeadSource, LeadStatus, Prisma, Priority } from '@michio/db';
import { normalizeVnPhone } from '@michio/shared';
import { recordAudit } from '../audit';
import { engineContext } from '../assignment/engine';
import { type Actor, type Db, MANAGER_ROLES, TX_OPTIONS } from '../context';
import type { Effects } from '../effects';
import { ConflictError, DomainError, NotFoundError } from '../errors';
import { type PageParams, pageArgs, toPage } from '../pagination';

export interface LeadFilters {
  status?: LeadStatus[];
  /** user id, or "none" for unassigned */
  ownerId?: string;
  source?: LeadSource[];
  priority?: Priority[];
  businessModel?: string[];
  province?: string;
  q?: string;
  from?: Date;
  to?: Date;
  slaBreached?: boolean;
}

export const leadListInclude = {
  customer: { select: { id: true, contactName: true, shopName: true, phone: true, province: true, businessModel: true, expectedOrderBand: true, lifecycle: true } },
  owner: { select: { id: true, fullName: true } },
  assignments: { where: { status: 'PENDING' }, select: { id: true, userId: true, acceptDeadline: true }, take: 1 },
} satisfies Prisma.LeadInclude;

/** Text search over name / shop / phone / code. */
export function leadSearchWhere(q: string | undefined): Prisma.LeadWhereInput | null {
  const s = q?.trim();
  if (!s) return null;
  const or: Prisma.LeadWhereInput[] = [
    { customer: { contactName: { contains: s, mode: 'insensitive' } } },
    { customer: { shopName: { contains: s, mode: 'insensitive' } } },
    { customer: { email: { contains: s.toLowerCase() } } },
  ];
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 4) {
    const e164 = normalizeVnPhone(s);
    or.push({ customer: { phone: { contains: e164 ?? digits.replace(/^0/, '') } } });
  }
  const code = s.replace(/^#/, '');
  if (/^\d{1,9}$/.test(code)) or.push({ code: Number(code) });
  return { OR: or };
}

export function slaBreachedWhere(now: Date): Prisma.LeadWhereInput {
  return {
    OR: [
      { status: 'ASSIGNED', assignments: { some: { status: 'PENDING', acceptDeadline: { lt: now } } } },
      { status: 'IN_PROGRESS', firstContactAt: null, firstContactDeadline: { lt: now } },
    ],
  };
}

export function leadWhere(user: AuthUser, f: LeadFilters, now = new Date()): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [{ ...scopeFilter(user, 'lead'), deletedAt: null }];
  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.ownerId) and.push({ ownerId: f.ownerId === 'none' ? null : f.ownerId });
  if (f.source?.length) and.push({ source: { in: f.source } });
  if (f.priority?.length) and.push({ priority: { in: f.priority } });
  if (f.businessModel?.length) and.push({ customer: { businessModel: { in: f.businessModel as never } } });
  if (f.province?.trim()) and.push({ customer: { province: { contains: f.province.trim(), mode: 'insensitive' } } });
  if (f.from || f.to) and.push({ createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } });
  if (f.slaBreached) and.push(slaBreachedWhere(now));
  const search = leadSearchWhere(f.q);
  if (search) and.push(search);
  return { AND: and };
}

export async function listLeads(db: Db, user: AuthUser, f: LeadFilters, page: PageParams = {}) {
  const rows = await db.lead.findMany({
    where: leadWhere(user, f),
    include: leadListInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...pageArgs(page),
  });
  return toPage(rows, page);
}

export async function getLead(db: Db, user: AuthUser, id: string) {
  const lead = await db.lead.findFirst({
    where: { id, orgId: user.orgId, deletedAt: null },
    include: {
      customer: { include: { owner: { select: { id: true, fullName: true } }, identities: { include: { channelAccount: { select: { type: true, name: true } } } } } },
      owner: { select: { id: true, fullName: true, phone: true } },
      assignments: {
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, fullName: true } }, rule: { select: { id: true, name: true } } },
      },
      deals: { where: { deletedAt: null }, include: { stage: true, lostReason: true } },
      tasks: { where: { status: 'TODO' }, orderBy: { dueAt: 'asc' } },
    },
  });
  if (!lead) throw new NotFoundError('Không tìm thấy lead');
  assertAuthorized(user, 'lead.view', lead);
  return lead;
}

export interface LeadPatch {
  need?: string | null;
  priority?: Priority;
  campaign?: string | null;
  /** Close as lost (SPEC 6.5: lý do bắt buộc). */
  status?: 'LOST';
  lostReasonId?: string;
  lostNote?: string | null;
}

export async function updateLead(db: Db, fx: Effects, actor: Actor, id: string, patch: LeadPatch) {
  const user = actor.user!;
  const lead = await db.lead.findFirst({ where: { id, orgId: actor.orgId, deletedAt: null } });
  if (!lead) throw new NotFoundError('Không tìm thấy lead');
  assertAuthorized(user, 'lead.update', lead);

  const data: Prisma.LeadUpdateInput = {};
  if (patch.need !== undefined) data.need = patch.need?.trim() || null;
  if (patch.priority) data.priority = patch.priority;
  if (patch.campaign !== undefined) data.campaign = patch.campaign?.trim() || null;

  const ctx = await engineContext(db, actor);
  const result = await db.$transaction(async (tx) => {
    if (patch.status === 'LOST') {
      if (lead.status === 'WON' || lead.status === 'LOST') throw new ConflictError('LEAD_CLOSED', 'Lead đã đóng');
      if (!patch.lostReasonId) throw new DomainError('VALIDATION_ERROR', 'Cần chọn lý do không thành công', 422);
      const reason = await tx.lostReason.findFirst({ where: { id: patch.lostReasonId, orgId: actor.orgId } });
      if (!reason) throw new DomainError('VALIDATION_ERROR', 'Lý do không hợp lệ', 422);
      data.status = 'LOST';
      const lostStage = await tx.pipelineStage.findFirst({ where: { orgId: actor.orgId, isLost: true } });
      if (lostStage) {
        await tx.deal.updateMany({
          where: { leadId: lead.id, closedAt: null, deletedAt: null },
          data: { stageId: lostStage.id, lostReasonId: reason.id, closedAt: ctx.now },
        });
      }
      await tx.leadAssignment.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'REASSIGNED', respondedAt: ctx.now } });
      await tx.activity.create({
        data: {
          orgId: lead.orgId,
          customerId: lead.customerId,
          leadId: lead.id,
          userId: user.id,
          type: 'STAGE_CHANGE',
          data: { to: 'THUA', lostReason: reason.name, note: patch.lostNote ?? null },
          createdAt: ctx.now,
        },
      });
    }
    const updated = await tx.lead.update({ where: { id }, data });
    await recordAudit(tx, {
      orgId: lead.orgId,
      actorId: user.id,
      via: actor.via,
      action: patch.status === 'LOST' ? 'lead.close' : 'lead.update',
      entityType: 'Lead',
      entityId: id,
      before: { need: lead.need, priority: lead.priority, campaign: lead.campaign, status: lead.status },
      after: { need: updated.need, priority: updated.priority, campaign: updated.campaign, status: updated.status },
      ip: actor.ip,
    });
    return updated;
  }, TX_OPTIONS);
  await fx.publish({ type: 'lead.updated', orgId: lead.orgId, userIds: lead.ownerId ? [lead.ownerId] : [], roles: MANAGER_ROLES, data: { leadId: id } });
  return result;
}

export async function deleteLead(db: Db, actor: Actor, id: string) {
  assertAuthorized(actor.user!, 'record.delete');
  const lead = await db.lead.findFirst({ where: { id, orgId: actor.orgId, deletedAt: null } });
  if (!lead) throw new NotFoundError('Không tìm thấy lead');
  await db.$transaction([
    db.lead.update({ where: { id }, data: { deletedAt: new Date() } }),
    db.leadAssignment.updateMany({ where: { leadId: id, status: 'PENDING' }, data: { status: 'REASSIGNED', respondedAt: new Date() } }),
    recordAudit(db, { orgId: lead.orgId, actorId: actor.user!.id, via: actor.via, action: 'lead.delete', entityType: 'Lead', entityId: id, before: { status: lead.status, ownerId: lead.ownerId }, ip: actor.ip }),
  ]);
}

export interface ActivityInput {
  type: 'CALL' | 'NOTE' | 'MEETING';
  /** CALL: ANSWERED | NO_ANSWER | CALL_BACK */
  result?: 'ANSWERED' | 'NO_ANSWER' | 'CALL_BACK';
  note?: string | null;
}

/**
 * Manual activity on a lead. A call/meeting by the assigned sales is the first contact
 * (FRT, SPEC 6.3.4) and implicitly accepts a pending assignment.
 */
export async function addLeadActivity(db: Db, fx: Effects, actor: Actor, leadId: string, input: ActivityInput) {
  const user = actor.user!;
  const lead = await db.lead.findFirst({ where: { id: leadId, orgId: actor.orgId, deletedAt: null } });
  if (!lead) throw new NotFoundError('Không tìm thấy lead');
  assertAuthorized(user, 'lead.update', lead);
  const ctx = await engineContext(db, actor);
  const { now } = ctx;

  const activity = await db.$transaction(async (tx) => {
    const isContact = input.type !== 'NOTE' && lead.ownerId === user.id;
    const leadData: Prisma.LeadUpdateInput = { lastActivityAt: now };
    if (isContact) {
      const pending = await tx.leadAssignment.findFirst({ where: { leadId, userId: user.id, status: 'PENDING' } });
      if (pending) {
        await tx.leadAssignment.update({ where: { id: pending.id }, data: { status: 'ACCEPTED', respondedAt: now } });
        leadData.status = 'IN_PROGRESS';
        leadData.acceptedAt = now;
      }
      if (!lead.firstContactAt) leadData.firstContactAt = now;
    }
    await tx.lead.update({ where: { id: leadId }, data: leadData });
    const a = await tx.activity.create({
      data: {
        orgId: lead.orgId,
        customerId: lead.customerId,
        leadId,
        userId: user.id,
        type: input.type,
        data: { result: input.result ?? null, note: input.note?.trim() || null },
        createdAt: now,
      },
    });
    await recordAudit(tx, {
      orgId: lead.orgId,
      actorId: user.id,
      via: actor.via,
      action: 'lead.activity',
      entityType: 'Lead',
      entityId: leadId,
      after: { activityId: a.id, type: input.type, firstContact: isContact && !lead.firstContactAt },
      ip: actor.ip,
    });
    return a;
  }, TX_OPTIONS);
  await fx.publish({ type: 'lead.updated', orgId: lead.orgId, userIds: lead.ownerId ? [lead.ownerId] : [], roles: MANAGER_ROLES, data: { leadId } });
  return activity;
}

/** Customer timeline (SPEC 6.9): activities of the lead plus customer-level ones, newest first. */
export async function leadTimeline(db: Db, user: AuthUser, leadId: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId, orgId: user.orgId, deletedAt: null }, select: { id: true, ownerId: true, customerId: true, orgId: true } });
  if (!lead) throw new NotFoundError('Không tìm thấy lead');
  assertAuthorized(user, 'lead.view', lead);
  return activityTimeline(db, { OR: [{ leadId }, { customerId: lead.customerId, leadId: null }] });
}

export async function activityTimeline(db: Db, where: Prisma.ActivityWhereInput, take = 200) {
  const items = await db.activity.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  const userIds = [...new Set(items.map((i) => i.userId).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return items.map((i) => ({ ...i, userName: i.userId ? (names.get(i.userId) ?? null) : null }));
}

/** Leads waiting for this sales to accept (S2 home), soonest deadline first. */
export async function pendingLeadsFor(db: Db, userId: string) {
  return db.leadAssignment.findMany({
    where: { userId, status: 'PENDING', lead: { deletedAt: null } },
    orderBy: { acceptDeadline: 'asc' },
    include: { lead: { include: { customer: { select: { contactName: true, shopName: true, province: true, phone: true, expectedOrderBand: true, interestCategories: true } } } } },
  });
}

