// Lead intake & de-duplication (SPEC 6.2). Every channel (website form, quick lead, import,
// Facebook/Zalo later) funnels through `intakeLead`.
import { assertAuthorized } from '@michio/auth';
import type { BusinessModel, Customer, LeadSource, OrderBand, Prisma, Priority } from '@michio/db';
import { LEAD_SOURCE_LABELS, normalizeVnPhone, priorityForBand } from '@michio/shared';
import { recordAudit } from '../audit';
import { assignDirectTx, engineContext, type EngineContext, queueLeadTx, routeLeadTx, type RouteOutcome } from '../assignment/engine';
import { type Actor, type Db, type Tx, TX_OPTIONS } from '../context';
import type { Effects } from '../effects';
import { DomainError, ValidationError } from '../errors';
import { notifyUsers } from '../notifications';

export const OPEN_LEAD_STATUSES = ['NEW', 'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS'] as const;

export interface LeadIntakeInput {
  source: LeadSource;
  contactName: string;
  phone?: string | null;
  email?: string | null;
  shopName?: string | null;
  taxCode?: string | null;
  businessModel?: BusinessModel | null;
  expectedOrderBand?: OrderBand | null;
  interestCategories?: string[];
  province?: string | null;
  address?: string | null;
  facebookUrl?: string | null;
  zaloPhone?: string | null;
  tags?: string[];
  need?: string | null;
  campaign?: string | null;
  utm?: Record<string, string> | null;
  formPayload?: Prisma.InputJsonValue | null;
  priority?: Priority | null;
  identity?: { channelAccountId: string; externalUserId: string; displayName?: string | null };
}

/**
 * auto: assignment rules (default for Owner/Manager, website, bot LEAD).
 * self: the creating sales keeps it (SPEC §3 "Tạo lead: SALES tự giao cho mình").
 * user: a given user (import "giao cho 1 người"). none: leave unassigned (import "chưa giao").
 */
export type IntakeAssign = { mode: 'auto' } | { mode: 'self' } | { mode: 'none' } | { mode: 'user'; userId: string };

export interface IntakeResult {
  leadId: string;
  code: number;
  customerId: string;
  duplicate: boolean;
  /** The customer existed already (matched by phone / email / channel identity). */
  existingCustomer: boolean;
  isRepurchase: boolean;
  assignedTo: { id: string; fullName: string } | null;
  outcome: RouteOutcome | null;
}

function clean(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? v : null;
}

export function normalizeIntake(input: LeadIntakeInput) {
  const rawPhone = clean(input.phone);
  const phone = rawPhone ? normalizeVnPhone(rawPhone) : null;
  if (rawPhone && !phone) throw new ValidationError('Số điện thoại không hợp lệ', { phone: ['Số điện thoại không hợp lệ'] });
  const email = clean(input.email)?.toLowerCase() ?? null;
  if (!phone && !email && !input.identity) {
    throw new ValidationError('Cần số điện thoại, email hoặc tài khoản mạng xã hội', { phone: ['Bắt buộc'] });
  }
  const contactName = clean(input.contactName);
  if (!contactName) throw new ValidationError('Cần tên người liên hệ', { contactName: ['Bắt buộc'] });
  return { ...input, contactName, phone, email };
}

/** Find an existing customer by normalized phone, then channel identity, then email (SPEC 6.2). */
export async function findDuplicateCustomer(
  db: Db | Tx,
  orgId: string,
  keys: { phone?: string | null; email?: string | null; identity?: { channelAccountId: string; externalUserId: string } },
): Promise<Customer | null> {
  if (keys.phone) {
    const c = await db.customer.findFirst({ where: { orgId, deletedAt: null, OR: [{ phone: keys.phone }, { zaloPhone: keys.phone }] }, orderBy: { createdAt: 'asc' } });
    if (c) return c;
  }
  if (keys.identity) {
    const ident = await db.customerIdentity.findUnique({
      where: { channelAccountId_externalUserId: keys.identity },
      include: { customer: true },
    });
    if (ident && !ident.customer.deletedAt && ident.customer.orgId === orgId) return ident.customer;
  }
  if (keys.email) {
    const c = await db.customer.findFirst({ where: { orgId, deletedAt: null, email: keys.email }, orderBy: { createdAt: 'asc' } });
    if (c) return c;
  }
  return null;
}

async function nextLeadCode(tx: Tx, orgId: string): Promise<number> {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`lead-code:${orgId}`}))) AS l`;
  const max = await tx.lead.aggregate({ where: { orgId }, _max: { code: true } });
  return Math.max(1000, max._max.code ?? 1000) + 1;
}

/** Fill only blank customer fields from a new contact; never overwrite what sales entered. */
function fillBlanks(c: Customer, input: ReturnType<typeof normalizeIntake>): Prisma.CustomerUpdateInput {
  const data: Prisma.CustomerUpdateInput = {};
  const set = <K extends keyof Customer & keyof Prisma.CustomerUpdateInput>(k: K, v: unknown) => {
    if ((c[k] === null || c[k] === undefined) && v !== null && v !== undefined && v !== '') (data as Record<string, unknown>)[k] = v;
  };
  set('phone', input.phone);
  set('email', input.email);
  set('shopName', clean(input.shopName));
  set('taxCode', clean(input.taxCode));
  set('businessModel', input.businessModel);
  set('province', clean(input.province));
  set('address', clean(input.address));
  set('facebookUrl', clean(input.facebookUrl));
  set('zaloPhone', input.zaloPhone ? normalizeVnPhone(input.zaloPhone) : null);
  if ((!c.expectedOrderBand || c.expectedOrderBand === 'UNKNOWN') && input.expectedOrderBand && input.expectedOrderBand !== 'UNKNOWN') {
    data.expectedOrderBand = input.expectedOrderBand;
  }
  const cats = [...new Set([...c.interestCategories, ...(input.interestCategories ?? [])])];
  if (cats.length !== c.interestCategories.length) data.interestCategories = cats;
  const tags = [...new Set([...c.tags, ...(input.tags ?? [])])];
  if (tags.length !== c.tags.length) data.tags = tags;
  return data;
}

/** Create-or-match a lead inside a transaction (shared by single intake and the import job). */
export async function intakeLeadTx(tx: Tx, ctx: EngineContext, raw: LeadIntakeInput, assignment: IntakeAssign): Promise<IntakeResult> {
  const { actor, now, settings } = ctx;
  const orgId = actor.orgId;
  const input = normalizeIntake(raw);
  const actorId = actor.user?.id ?? null;

  // Serialize concurrent submissions for the same person so they can't both create a customer.
  const dedupeKey = input.phone ?? (input.identity ? `${input.identity.channelAccountId}:${input.identity.externalUserId}` : input.email);
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`intake:${orgId}:${dedupeKey}`}))) AS l`;

  let customer = await findDuplicateCustomer(tx, orgId, { phone: input.phone, email: input.email, identity: input.identity });
  const existingCustomer = !!customer;

  if (customer) {
    const patch = fillBlanks(customer, input);
    if (Object.keys(patch).length) customer = await tx.customer.update({ where: { id: customer.id }, data: patch });
  } else {
    customer = await tx.customer.create({
      data: {
        orgId,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        shopName: clean(input.shopName),
        taxCode: clean(input.taxCode),
        businessModel: input.businessModel ?? null,
        expectedOrderBand: input.expectedOrderBand ?? null,
        interestCategories: input.interestCategories ?? [],
        province: clean(input.province),
        address: clean(input.address),
        facebookUrl: clean(input.facebookUrl),
        zaloPhone: input.zaloPhone ? normalizeVnPhone(input.zaloPhone) : null,
        tags: input.tags ?? [],
        reorderCycleDays: settings['reorder.defaultCycleDays'],
        createdAt: now,
      },
    });
    await recordAudit(tx, { orgId, actorId, via: actor.via, action: 'customer.create', entityType: 'Customer', entityId: customer.id, after: { contactName: customer.contactName, source: input.source }, ip: actor.ip });
  }
  if (input.identity) {
    await tx.customerIdentity.upsert({
      where: { channelAccountId_externalUserId: { channelAccountId: input.identity.channelAccountId, externalUserId: input.identity.externalUserId } },
      create: { customerId: customer.id, ...input.identity },
      update: {},
    });
  }

  // Open lead already → no new lead; log the re-contact and tell whoever holds it.
  const open = await tx.lead.findFirst({
    where: { customerId: customer.id, deletedAt: null, status: { in: [...OPEN_LEAD_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    include: { owner: { select: { id: true, fullName: true } } },
  });
  if (open) {
    await tx.activity.create({
      data: {
        orgId,
        customerId: customer.id,
        leadId: open.id,
        userId: actorId,
        type: 'SYSTEM',
        data: { kind: 'RECONTACT', source: input.source, note: clean(input.need), text: `Liên hệ lại qua ${LEAD_SOURCE_LABELS[input.source]}` },
        createdAt: now,
      },
    });
    if (open.ownerId && open.ownerId !== actorId) {
      await notifyUsers(tx, ctx.fx, orgId, [open.ownerId], {
        type: 'lead.recontact',
        title: `💬 ${customer.contactName} liên hệ lại (lead #${open.code})`,
        body: `Qua ${LEAD_SOURCE_LABELS[input.source]}${clean(input.need) ? `: "${clean(input.need)!.slice(0, 120)}"` : ''}`,
        link: `/leads/${open.id}`,
      });
    }
    ctx.fx.publish({ type: 'lead.updated', orgId, userIds: open.ownerId ? [open.ownerId] : [], roles: ['OWNER', 'MANAGER'], data: { leadId: open.id, recontact: true } });
    return {
      leadId: open.id,
      code: open.code,
      customerId: customer.id,
      duplicate: true,
      existingCustomer,
      isRepurchase: open.isRepurchase,
      assignedTo: open.owner,
      outcome: null,
    };
  }

  const band = input.expectedOrderBand ?? customer.expectedOrderBand;
  const lead = await tx.lead.create({
    data: {
      orgId,
      code: await nextLeadCode(tx, orgId),
      customerId: customer.id,
      source: input.source,
      isRepurchase: customer.orderCount > 0,
      campaign: clean(input.campaign) ?? input.utm?.campaign ?? null,
      utm: input.utm ?? undefined,
      formPayload: input.formPayload ?? undefined,
      priority: input.priority ?? priorityForBand(band, settings['priority.byOrderBand']),
      need: clean(input.need),
      createdAt: now,
    },
  });
  await recordAudit(tx, {
    orgId,
    actorId,
    via: actor.via,
    action: 'lead.create',
    entityType: 'Lead',
    entityId: lead.id,
    after: { code: lead.code, source: lead.source, customerId: customer.id, priority: lead.priority },
    ip: actor.ip,
  });

  let outcome: RouteOutcome;
  if (assignment.mode === 'self') {
    if (!actorId) throw new DomainError('UNAUTHENTICATED', 'Cần đăng nhập', 401);
    outcome = await assignDirectTx(tx, ctx, lead.id, actorId, { accepted: true });
  } else if (assignment.mode === 'user') {
    outcome = await assignDirectTx(tx, ctx, lead.id, assignment.userId, { accepted: true });
  } else if (assignment.mode === 'none') {
    outcome = await queueLeadTx(tx, ctx, lead.id, 'UNASSIGNED_BY_CHOICE');
  } else {
    outcome = await routeLeadTx(tx, ctx, lead.id);
  }

  return {
    leadId: lead.id,
    code: lead.code,
    customerId: customer.id,
    duplicate: false,
    existingCustomer,
    isRepurchase: lead.isRepurchase,
    assignedTo: outcome.kind === 'ASSIGNED' ? { id: outcome.userId, fullName: outcome.userName } : null,
    outcome,
  };
}

/** Default assignment for a user-created lead (SPEC §3 + 5.3 chế độ A). */
export function defaultAssignFor(actor: Actor): IntakeAssign {
  return actor.user?.role === 'SALES' ? { mode: 'self' } : { mode: 'auto' };
}

export async function intakeLead(db: Db, fx: Effects, actor: Actor, input: LeadIntakeInput, assignment?: IntakeAssign): Promise<IntakeResult> {
  if (actor.user) assertAuthorized(actor.user, 'lead.create');
  if (assignment?.mode === 'user' && actor.user) assertAuthorized(actor.user, 'lead.assign');
  const ctx = await engineContext(db, actor);
  const result = await db.$transaction((tx) => intakeLeadTx(tx, ctx, input, assignment ?? defaultAssignFor(actor)), TX_OPTIONS);
  await ctx.fx.flush(fx);
  return result;
}
