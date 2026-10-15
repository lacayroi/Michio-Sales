// Lead intake & dedupe (SPEC 6.2) and lead activities.
import { assertAuthorized, authorize } from '@michio/auth';
import type { BusinessModel, Customer, LeadSource, OrderBand, Prisma } from '@michio/db';
import { LEAD_SOURCE_LABELS, normalizeVnPhone } from '@michio/shared';
import { z } from 'zod';
import { type AssignOutcome, assignDirect, assignLead, OPEN_LEAD_STATUSES } from './assignment';
import { recordAudit } from './audit';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';
import { notifyUsers } from './notifications';
import { getSettings } from './settings';

type Tx = Prisma.TransactionClient;

const LEAD_SOURCES = [
  'WEBSITE_WHOLESALE_FORM', 'WEBSITE_AGENT_FORM', 'FACEBOOK_MESSENGER', 'FACEBOOK_LEAD_ADS', 'ZALO_COMPANY',
  'ZALO_OA', 'HOTLINE', 'REFERRAL', 'IMPORT', 'MANUAL', 'OTHER',
] as const;
const BUSINESS_MODELS = ['JAPAN_STORE', 'ONLINE_SHOP', 'MINIMART', 'RETAIL_AGENT', 'CAFE', 'DISTRIBUTOR', 'OTHER'] as const;
const ORDER_BANDS = ['LT_5M', 'B5_10M', 'B10_30M', 'B30_50M', 'GT_50M', 'UNKNOWN'] as const;

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const LeadIntakeInput = z
  .object({
    source: z.enum(LEAD_SOURCES),
    fullName: z.string().trim().min(1, 'Cần tên người liên hệ').max(120),
    phone: optionalText(30),
    email: z.preprocess((v) => (v === '' ? undefined : v), z.email('Email không hợp lệ').max(200).optional()),
    shopName: optionalText(200),
    taxCode: optionalText(20),
    province: optionalText(80),
    address: optionalText(300),
    businessModel: z.enum(BUSINESS_MODELS).optional(),
    expectedOrderBand: z.enum(ORDER_BANDS).optional(),
    interestCategories: z.array(z.string().max(60)).max(30).optional(),
    facebookUrl: optionalText(300),
    zaloPhone: optionalText(30),
    tags: z.array(z.string().max(40)).max(20).optional(),
    need: optionalText(2000),
    campaign: optionalText(120),
    utm: z.record(z.string(), z.string().max(200)).optional(),
    formPayload: z.record(z.string(), z.unknown()).optional(),
    identity: z.object({ channelAccountId: z.string(), externalUserId: z.string(), displayName: z.string().optional() }).optional(),
    /**
     * AUTO = engine (rotation / customer owner); SELF = creator keeps it (SALES default, SPEC §3
     * "tự giao cho mình"); USER = Owner/Manager picks someone.
     */
    assignMode: z.enum(['AUTO', 'SELF', 'USER']).default('AUTO'),
    assignToUserId: z.string().optional(),
  })
  .refine((v) => v.phone || v.email || v.identity, { message: 'Cần SĐT, email hoặc tài khoản mạng xã hội', path: ['phone'] });
export type LeadIntakeInput = z.input<typeof LeadIntakeInput>;

export interface IntakeResult {
  leadId: string;
  code: number;
  customerId: string;
  duplicate: boolean;
  assignment: AssignOutcome | null;
  assignedTo: string | null;
}

/** Fill only empty customer fields; never overwrite data a salesperson already curated. */
function mergeCustomerData(existing: Customer, input: z.output<typeof LeadIntakeInput>, phone: string | null) {
  const pick = <T>(cur: T | null, next: T | undefined) => (cur === null || cur === undefined || cur === '' ? next : undefined);
  const data: Prisma.CustomerUpdateInput = {
    phone: pick(existing.phone, phone ?? undefined),
    email: pick(existing.email, input.email),
    shopName: pick(existing.shopName, input.shopName),
    taxCode: pick(existing.taxCode, input.taxCode),
    province: pick(existing.province, input.province),
    address: pick(existing.address, input.address),
    businessModel: pick(existing.businessModel, input.businessModel as BusinessModel | undefined),
    expectedOrderBand: pick(existing.expectedOrderBand, input.expectedOrderBand as OrderBand | undefined),
    facebookUrl: pick(existing.facebookUrl, input.facebookUrl),
    zaloPhone: pick(existing.zaloPhone, input.zaloPhone),
  };
  const cats = [...new Set([...existing.interestCategories, ...(input.interestCategories ?? [])])];
  if (cats.length !== existing.interestCategories.length) data.interestCategories = cats;
  const tags = [...new Set([...existing.tags, ...(input.tags ?? [])])];
  if (tags.length !== existing.tags.length) data.tags = tags;
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Prisma.CustomerUpdateInput;
}

async function findExistingCustomer(tx: Tx, orgId: string, phone: string | null, email: string | undefined, identity?: { channelAccountId: string; externalUserId: string }) {
  if (identity) {
    const ident = await tx.customerIdentity.findUnique({
      where: { channelAccountId_externalUserId: identity },
      include: { customer: true },
    });
    if (ident && !ident.customer.deletedAt) return ident.customer;
  }
  if (phone) {
    const c = await tx.customer.findFirst({ where: { orgId, phone, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (c) return c;
  }
  if (email) {
    const c = await tx.customer.findFirst({ where: { orgId, email: { equals: email, mode: 'insensitive' }, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (c) return c;
  }
  return null;
}

/**
 * Single entry point for every lead source (form, quick lead, import, Messenger, Zalo bot).
 * Dedupe key: normalized phone OR (channel, externalUserId) OR email.
 */
export async function intakeLead(ctx: ServiceContext, raw: LeadIntakeInput): Promise<IntakeResult> {
  const input = LeadIntakeInput.parse(raw);
  const phone = input.phone ? normalizeVnPhone(input.phone) : null;
  if (input.phone && !phone) throw new DomainError('VALIDATION_ERROR', 'Số điện thoại không hợp lệ', { phone: ['Số điện thoại không hợp lệ'] });

  const actor = ctx.actor;
  if (actor) assertAuthorized(actor, 'lead.create');
  if (input.assignMode === 'USER' && actor && !authorize(actor, 'lead.assign')) {
    throw new DomainError('VALIDATION_ERROR', 'Bạn chỉ có thể tự nhận lead hoặc để hệ thống chia');
  }

  const outbox = new Outbox(ctx.effects);
  const step = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    // Serialize intakes for the same person so duplicate webhooks/forms cannot create two leads.
    const lockKey = phone ?? input.email?.toLowerCase() ?? `${input.identity?.channelAccountId}:${input.identity?.externalUserId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`intake:${ctx.orgId}:${lockKey}`}))`;

    let customer = await findExistingCustomer(tx, ctx.orgId, phone, input.email, input.identity);
    if (customer) {
      const data = mergeCustomerData(customer, input, phone);
      if (Object.keys(data).length) customer = await tx.customer.update({ where: { id: customer.id }, data });
    } else {
      customer = await tx.customer.create({
        data: {
          orgId: ctx.orgId,
          contactName: input.fullName,
          phone,
          email: input.email,
          shopName: input.shopName,
          taxCode: input.taxCode,
          province: input.province,
          address: input.address,
          businessModel: input.businessModel,
          expectedOrderBand: input.expectedOrderBand,
          interestCategories: input.interestCategories ?? [],
          facebookUrl: input.facebookUrl,
          zaloPhone: input.zaloPhone,
          tags: input.tags ?? [],
          createdAt: now,
        },
      });
      await recordAudit(tx, {
        orgId: ctx.orgId, actorId: actor?.id ?? null, via: ctx.via, action: 'customer.create', entityType: 'Customer', entityId: customer.id,
        after: { contactName: customer.contactName, phone: customer.phone, source: input.source }, ip: ctx.ip,
      });
    }
    if (input.identity) {
      await tx.customerIdentity.upsert({
        where: { channelAccountId_externalUserId: { channelAccountId: input.identity.channelAccountId, externalUserId: input.identity.externalUserId } },
        create: { customerId: customer.id, ...input.identity },
        update: {},
      });
    }

    // 1) An open lead exists → no new lead; log "Liên hệ lại" and tell its owner.
    const open = await tx.lead.findFirst({
      where: { customerId: customer.id, status: { in: [...OPEN_LEAD_STATUSES] }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { fullName: true } } },
    });
    if (open) {
      await tx.activity.create({
        data: {
          orgId: ctx.orgId, customerId: customer.id, leadId: open.id, userId: actor?.id ?? null, type: 'SYSTEM',
          data: { kind: 'recontact', source: input.source, note: input.need ?? null, label: `Liên hệ lại qua ${LEAD_SOURCE_LABELS[input.source]}` },
          createdAt: now,
        },
      });
      await tx.lead.update({ where: { id: open.id }, data: { lastActivityAt: now } });
      if (open.ownerId) {
        await notifyUsers(tx, outbox, ctx.orgId, [open.ownerId], {
          type: 'lead.recontact',
          title: `💬 ${customer.contactName} liên hệ lại (lead #${open.code})`,
          body: `Qua ${LEAD_SOURCE_LABELS[input.source]}${input.need ? `: "${input.need.slice(0, 120)}"` : ''}`,
          link: `/leads/${open.id}`,
        });
      }
      outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: open.ownerId ? [open.ownerId] : [], roles: MANAGERS }, data: { leadId: open.id } });
      return { kind: 'duplicate' as const, leadId: open.id, code: open.code, customerId: customer.id, ownerName: open.owner?.fullName ?? null };
    }

    // 2) New lead.
    const settings = await getSettings(tx, ctx.orgId, ['priority.byOrderBand', 'assignment.keepCustomerOwner', 'assignment.preferPreviousOwner']);
    const band = (customer.expectedOrderBand ?? 'UNKNOWN') as keyof (typeof settings)['priority.byOrderBand'];
    const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('lead_code_seq')`;
    const lead = await tx.lead.create({
      data: {
        orgId: ctx.orgId,
        code: Number(nextval),
        customerId: customer.id,
        source: input.source as LeadSource,
        isRepurchase: customer.orderCount > 0,
        campaign: input.campaign ?? (input.utm?.campaign as string | undefined),
        utm: input.utm,
        formPayload: input.formPayload as Prisma.InputJsonValue | undefined,
        priority: settings['priority.byOrderBand'][band] ?? 'COLD',
        need: input.need,
        createdAt: now,
        lastActivityAt: now,
      },
    });
    await tx.activity.create({
      data: { orgId: ctx.orgId, customerId: customer.id, leadId: lead.id, userId: actor?.id ?? null, type: 'SYSTEM', data: { kind: 'created', source: input.source }, createdAt: now },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor?.id ?? null, via: ctx.via, action: 'lead.create', entityType: 'Lead', entityId: lead.id,
      after: { code: lead.code, source: lead.source, priority: lead.priority, customerId: customer.id }, ip: ctx.ip,
    });

    // Routing decision (SPEC 6.2 / 6.3.4).
    let preferred: { userId: string; method: 'CUSTOMER_OWNER' | 'PREVIOUS_OWNER'; requireAvailable: boolean } | undefined;
    if (customer.orderCount > 0 && customer.ownerId && settings['assignment.keepCustomerOwner']) {
      preferred = { userId: customer.ownerId, method: 'CUSTOMER_OWNER', requireAvailable: false };
    } else if (settings['assignment.preferPreviousOwner']) {
      const lost = await tx.lead.findFirst({
        where: { customerId: customer.id, status: 'LOST', ownerId: { not: null }, id: { not: lead.id } },
        orderBy: { updatedAt: 'desc' },
      });
      if (lost?.ownerId) preferred = { userId: lost.ownerId, method: 'PREVIOUS_OWNER', requireAvailable: true };
    }
    return { kind: 'created' as const, leadId: lead.id, code: lead.code, customerId: customer.id, preferred };
  }, TX_OPTIONS);
  await outbox.flush();

  if (step.kind === 'duplicate') {
    return { leadId: step.leadId, code: step.code, customerId: step.customerId, duplicate: true, assignment: null, assignedTo: step.ownerName };
  }

  let assignment: AssignOutcome;
  const selfAssign = actor && (input.assignMode === 'SELF' || (input.assignMode === 'USER' && input.assignToUserId === actor.id));
  if (selfAssign || (input.assignMode === 'USER' && input.assignToUserId)) {
    // Self-assignment needs only lead.create (SPEC §3); choosing someone else needs lead.assign (checked above).
    const target = selfAssign ? actor.id : (input.assignToUserId as string);
    const [r] = await assignDirect(ctx, [step.leadId], target);
    if (!r?.ok) throw new DomainError('INVALID_STATE', r?.error ?? 'Không giao được lead');
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: target }, select: { fullName: true } });
    assignment = { status: 'ASSIGNED', assignmentId: '', userId: target, userName: user.fullName, method: 'MANUAL', acceptDeadline: null };
  } else {
    assignment = await assignLead(ctx, step.leadId, { preferred: step.preferred });
  }

  return {
    leadId: step.leadId,
    code: step.code,
    customerId: step.customerId,
    duplicate: false,
    assignment,
    assignedTo: assignment.status === 'ASSIGNED' ? assignment.userName : null,
  };
}

// ---------- activities ----------

export const LeadActivityInput = z.object({
  type: z.enum(['NOTE', 'CALL', 'MEETING']),
  note: z.string().trim().max(2000).optional(),
  /** CALL result (SPEC 6.9): nghe máy / không nghe / hẹn gọi lại */
  result: z.enum(['ANSWERED', 'NO_ANSWER', 'CALL_BACK']).optional(),
});

/** Logs a call/meeting/note. A CALL or MEETING counts as first contact (SPEC 6.3.4 onFirstContact). */
export async function addLeadActivity(ctx: ServiceContext, leadId: string, raw: z.input<typeof LeadActivityInput>) {
  const input = LeadActivityInput.parse(raw);
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const lead = await tx.lead.findFirst({ where: { id: leadId, orgId: ctx.orgId, deletedAt: null } });
    if (!lead) throw notFound('lead');
    assertAuthorized(actor, 'lead.update', lead);
    const activity = await tx.activity.create({
      data: { orgId: ctx.orgId, customerId: lead.customerId, leadId, userId: actor.id, type: input.type, data: { note: input.note ?? null, result: input.result ?? null }, createdAt: now },
    });
    const isContact = input.type !== 'NOTE' && input.result !== 'NO_ANSWER';
    const firstContact = isContact && !lead.firstContactAt;
    await tx.lead.update({ where: { id: leadId }, data: { lastActivityAt: now, ...(firstContact ? { firstContactAt: now } : {}) } });
    if (firstContact) {
      await recordAudit(tx, {
        orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'lead.first_contact', entityType: 'Lead', entityId: leadId,
        before: { firstContactAt: null }, after: { firstContactAt: now.toISOString(), activityId: activity.id }, ip: ctx.ip,
      });
    }
    outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: lead.ownerId ? [lead.ownerId] : [], roles: MANAGERS }, data: { leadId } });
    return activity;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

// ---------- updates ----------

export const LeadUpdateInput = z.object({
  priority: z.enum(['HOT', 'WARM', 'COLD']).optional(),
  need: z.string().trim().max(2000).nullable().optional(),
  campaign: z.string().trim().max(120).nullable().optional(),
  /** Closing a lead from the lead screen; pipeline (M4) will drive this through deals. */
  status: z.enum(['WON', 'LOST']).optional(),
});

export async function updateLead(ctx: ServiceContext, leadId: string, raw: z.input<typeof LeadUpdateInput>) {
  const input = LeadUpdateInput.parse(raw);
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, orgId: ctx.orgId, deletedAt: null } });
    if (!lead) throw notFound('lead');
    assertAuthorized(actor, 'lead.update', lead);
    if (input.status && lead.status !== 'IN_PROGRESS') throw new DomainError('INVALID_STATE', 'Chỉ đóng được lead đang xử lý');
    const updated = await tx.lead.update({ where: { id: leadId }, data: { ...input, lastActivityAt: ctx.now() } });
    if (input.status) {
      await tx.leadAssignment.updateMany({ where: { leadId, status: 'PENDING' }, data: { status: 'REASSIGNED' } });
    }
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'lead.update', entityType: 'Lead', entityId: leadId,
      before: { priority: lead.priority, need: lead.need, campaign: lead.campaign, status: lead.status },
      after: { priority: updated.priority, need: updated.need, campaign: updated.campaign, status: updated.status }, ip: ctx.ip,
    });
    outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: lead.ownerId ? [lead.ownerId] : [], roles: MANAGERS }, data: { leadId } });
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

export async function softDeleteLead(ctx: ServiceContext, leadId: string) {
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  assertAuthorized(actor, 'record.delete');
  return ctx.db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, orgId: ctx.orgId, deletedAt: null } });
    if (!lead) throw notFound('lead');
    await tx.lead.update({ where: { id: leadId }, data: { deletedAt: ctx.now() } });
    await tx.leadAssignment.updateMany({ where: { leadId, status: 'PENDING' }, data: { status: 'REASSIGNED' } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'lead.delete', entityType: 'Lead', entityId: leadId, before: { status: lead.status }, ip: ctx.ip });
  });
}
