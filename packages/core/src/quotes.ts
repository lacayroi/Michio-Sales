// Báo giá sỉ (SPEC 6.6): DRAFT → (PENDING_APPROVAL →) SENT → ACCEPTED / REJECTED / EXPIRED.
// Prices come from the customer's tier list; extra discount above `quote.maxExtraDiscountPct` needs
// Owner/Manager approval. Sending moves the deal to BAO_GIA and schedules a follow-up task.
import { assertAuthorized, authorize, scopeFilter } from '@michio/auth';
import type { Prisma, QuoteStatus } from '@michio/db';
import { type CompanyProfile, DEFAULT_QUOTE_TERMS, formatVnd, type QuotePdfData, vnDayRange } from '@michio/shared';
import { z } from 'zod';
import { recordAudit } from './audit';
import { addBusinessDays } from './business-time';
import { loadCalendar } from './calendar';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';
import { canAccessConversation, conversationWindow, queueConversationMessages } from './messenger';
import { managerIds, notifyUsers } from './notifications';
import { createOrder } from './orders';
import { computeLine, computeTotals, priceLines } from './pricing';
import { getSettings } from './settings';
import { appUrl, type ObjectStorage, signedFilePath, storageKey } from './storage';

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

/** Line as stored in Quote.items (SPEC §7): unitPrice = tier price, discountPct = extra discount. */
export interface QuoteItem {
  productId: string;
  sku: string;
  name: string;
  unit: string | null;
  unitsPerCase: number | null;
  imageUrl: string | null;
  qty: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
  /** Price came from the retail price (product missing in the wholesale list). */
  priceSource?: string;
}

export const quoteItems = (v: unknown) => (Array.isArray(v) ? (v as QuoteItem[]) : []);

export async function getCompanyProfile(db: ServiceContext['db'] | Tx, orgId: string): Promise<CompanyProfile> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const p = (org.profile ?? {}) as Partial<CompanyProfile>;
  return { legalName: p.legalName ?? org.name, address: p.address ?? '', hotline: p.hotline ?? '', ...p, quoteTerms: p.quoteTerms ?? DEFAULT_QUOTE_TERMS };
}

const text = (max: number) => z.string().trim().max(max).nullable().optional();
export const CompanyProfileInput = z.object({
  legalName: z.string().trim().min(1, 'Cần tên công ty').max(200),
  address: z.string().trim().min(1, 'Cần địa chỉ').max(300),
  hotline: z.string().trim().min(1, 'Cần hotline').max(40),
  zaloPhone: text(40),
  website: text(200),
  email: z.union([z.email(), z.literal(''), z.null()]).optional(),
  facebookPage: text(200),
  taxCode: text(20),
  bankName: text(120),
  bankAccount: text(40),
  bankAccountName: text(120),
  quoteTerms: text(2000),
});

export async function updateCompanyProfile(ctx: ServiceContext, raw: z.input<typeof CompanyProfileInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'settings.manage');
  const input = CompanyProfileInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const before = (org.profile ?? {}) as Record<string, unknown>;
    const profile = { ...before, ...input, email: input.email || null };
    await tx.organization.update({ where: { id: ctx.orgId }, data: { profile } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'settings.companyProfile', entityType: 'Organization', entityId: ctx.orgId, before: before as Prisma.InputJsonValue, after: profile as Prisma.InputJsonValue, ip: ctx.ip });
    return profile;
  });
}

// ---------- create / edit ----------

export const QuoteInput = z.object({
  customerId: z.string(),
  dealId: z.string().nullable().optional(),
  items: z
    .array(z.object({ productId: z.string(), qty: z.coerce.number().int().min(1).max(1_000_000), discountPct: z.coerce.number().min(0).max(100).default(0) }))
    .min(1, 'Báo giá cần ít nhất 1 dòng hàng')
    .max(200),
  shippingFee: z.coerce.number().int().min(0).default(0),
  terms: z.string().trim().max(2000).nullable().optional(),
  validDays: z.coerce.number().int().min(1).max(90).optional(),
});

async function nextQuoteCode(tx: Tx, now: Date) {
  const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('quote_code_seq')`;
  const year = new Date(vnDayRange(now).start.getTime() + 7 * 3600_000).getUTCFullYear();
  return `BG-${year}-${String(nextval).padStart(6, '0')}`;
}

/** End of the Vietnam day `days` days from now. */
const validUntilFrom = (now: Date, days: number) => new Date(vnDayRange(new Date(now.getTime() + days * DAY)).end.getTime() - 1);

async function buildQuoteLines(tx: Tx, ctx: ServiceContext, customer: { priceListId: string | null; tier: string | null }, items: z.output<typeof QuoteInput>['items']) {
  const priced = await priceLines(tx, ctx.orgId, customer, items, ctx.now());
  const lines: QuoteItem[] = priced.lines.map((l, i) => {
    const discountPct = items[i]!.discountPct;
    return {
      productId: l.productId, sku: l.sku, name: l.name, unit: l.unit, unitsPerCase: l.unitsPerCase, imageUrl: l.imageUrl,
      qty: l.qty, unitPrice: l.unitPrice, discountPct, lineTotal: computeLine({ qty: l.qty, unitPrice: l.unitPrice, discountPct }).lineTotal,
      ...(l.source !== 'PRICE_LIST' ? { priceSource: l.source } : {}),
    };
  });
  return { lines, priceList: priced.priceList };
}

/** Extra discount above the Owner's limit needs approval unless the author can approve (SPEC 6.6). */
async function needsApproval(tx: Tx, ctx: ServiceContext, lines: QuoteItem[]) {
  const { 'quote.maxExtraDiscountPct': max } = await getSettings(tx, ctx.orgId, ['quote.maxExtraDiscountPct']);
  return lines.some((l) => l.discountPct > max) && !authorize(actorOf(ctx), 'quote.approve');
}

async function linkDeal(tx: Tx, orgId: string, customerId: string, dealId: string | null | undefined) {
  if (dealId) {
    const d = await tx.deal.findFirst({ where: { id: dealId, orgId, customerId, deletedAt: null } });
    if (!d) throw new DomainError('VALIDATION_ERROR', 'Cơ hội không thuộc khách này');
    return d.id;
  }
  const lead = await tx.lead.findFirst({ where: { customerId, status: 'IN_PROGRESS', deletedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!lead) return null;
  const deal = await tx.deal.findFirst({ where: { leadId: lead.id, closedAt: null, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  return deal?.id ?? null;
}

export async function createQuote(ctx: ServiceContext, raw: z.input<typeof QuoteInput>) {
  const actor = actorOf(ctx);
  const input = QuoteInput.parse(raw);
  const outbox = new Outbox(ctx.effects);
  const quote = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId: ctx.orgId, deletedAt: null } });
    if (!customer || !authorize(actor, 'customer.view', customer)) throw notFound('khách hàng');
    const ownerId = customer.ownerId ?? actor.id;
    assertAuthorized(actor, 'quote.manage', { orgId: ctx.orgId, ownerId });
    const { lines } = await buildQuoteLines(tx, ctx, customer, input.items);
    const totals = computeTotals(lines, input.shippingFee);
    const settings = await getSettings(tx, ctx.orgId, ['quote.validDays']);
    const pending = await needsApproval(tx, ctx, lines);
    const q = await tx.quote.create({
      data: {
        orgId: ctx.orgId, code: await nextQuoteCode(tx, now), customerId: customer.id, dealId: await linkDeal(tx, ctx.orgId, customer.id, input.dealId), ownerId,
        status: pending ? 'PENDING_APPROVAL' : 'DRAFT', items: lines as unknown as Prisma.InputJsonValue,
        subtotal: totals.subtotal, discount: totals.discount, shippingFee: totals.shippingFee, total: totals.total,
        validUntil: validUntilFrom(now, input.validDays ?? settings['quote.validDays']), terms: input.terms ?? (await getCompanyProfile(tx, ctx.orgId)).quoteTerms,
        createdAt: now,
      },
    });
    await tx.activity.create({ data: { orgId: ctx.orgId, customerId: customer.id, userId: actor.id, type: 'QUOTE', data: { kind: 'created', quoteId: q.id, code: q.code, total: totals.total }, createdAt: now } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'quote.create', entityType: 'Quote', entityId: q.id, after: { code: q.code, customerId: customer.id, total: totals.total, lines: lines.length, status: q.status }, ip: ctx.ip });
    if (pending) await askApproval(tx, outbox, ctx, q, actor.id);
    return q;
  }, TX_OPTIONS);
  await outbox.flush();
  return quote;
}

async function askApproval(tx: Tx, outbox: Outbox, ctx: ServiceContext, q: { id: string; code: string; total: unknown }, actorId: string) {
  const approvers = (await managerIds(tx, ctx.orgId)).filter((id) => id !== actorId);
  await notifyUsers(tx, outbox, ctx.orgId, approvers, {
    type: 'quote.approval',
    title: `🧾 Báo giá ${q.code} cần duyệt chiết khấu`,
    body: `Tổng ${formatVnd(Number(q.total))} — chiết khấu thêm vượt mức cho phép.`,
    link: `/bao-gia/${q.id}`,
  });
}

async function loadQuote(tx: Tx | ServiceContext['db'], ctx: ServiceContext, quoteId: string) {
  const actor = actorOf(ctx);
  const q = await tx.quote.findFirst({ where: { id: quoteId, orgId: ctx.orgId } });
  if (!q || !authorize(actor, 'quote.view', q)) throw notFound('báo giá');
  return { actor, q };
}

export async function updateQuote(ctx: ServiceContext, quoteId: string, raw: z.input<typeof QuoteInput>) {
  const input = QuoteInput.parse(raw);
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const { actor, q } = await loadQuote(tx, ctx, quoteId);
    assertAuthorized(actor, 'quote.manage', q);
    if (q.status !== 'DRAFT' && q.status !== 'PENDING_APPROVAL') throw new DomainError('INVALID_STATE', 'Chỉ sửa được báo giá nháp');
    if (input.customerId !== q.customerId) throw new DomainError('VALIDATION_ERROR', 'Không đổi khách của báo giá');
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } });
    const { lines } = await buildQuoteLines(tx, ctx, customer, input.items);
    const totals = computeTotals(lines, input.shippingFee);
    const pending = await needsApproval(tx, ctx, lines);
    const updated = await tx.quote.update({
      where: { id: q.id },
      data: {
        items: lines as unknown as Prisma.InputJsonValue, subtotal: totals.subtotal, discount: totals.discount, shippingFee: totals.shippingFee, total: totals.total,
        terms: input.terms === undefined ? q.terms : input.terms, status: pending ? 'PENDING_APPROVAL' : 'DRAFT', approvedById: null, pdfKey: null,
        ...(input.validDays ? { validUntil: validUntilFrom(ctx.now(), input.validDays) } : {}),
        ...(input.dealId !== undefined ? { dealId: await linkDeal(tx, ctx.orgId, q.customerId, input.dealId) } : {}),
      },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'quote.update', entityType: 'Quote', entityId: q.id,
      before: { total: Number(q.total), lines: quoteItems(q.items).length, status: q.status }, after: { total: totals.total, lines: lines.length, status: updated.status }, ip: ctx.ip,
    });
    if (pending && q.status !== 'PENDING_APPROVAL') await askApproval(tx, outbox, ctx, updated, actor.id);
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

export async function approveQuote(ctx: ServiceContext, quoteId: string) {
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const { actor, q } = await loadQuote(tx, ctx, quoteId);
    assertAuthorized(actor, 'quote.approve', q);
    if (q.status !== 'PENDING_APPROVAL') throw new DomainError('INVALID_STATE', 'Báo giá không chờ duyệt');
    const updated = await tx.quote.update({ where: { id: q.id }, data: { status: 'DRAFT', approvedById: actor.id } });
    await tx.activity.create({ data: { orgId: ctx.orgId, customerId: q.customerId, userId: actor.id, type: 'QUOTE', data: { kind: 'approved', quoteId: q.id, code: q.code }, createdAt: ctx.now() } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'quote.approve', entityType: 'Quote', entityId: q.id, before: { status: q.status }, after: { status: 'DRAFT', approvedById: actor.id }, ip: ctx.ip });
    if (q.ownerId !== actor.id) {
      await notifyUsers(tx, outbox, ctx.orgId, [q.ownerId], { type: 'quote.approved', title: `✅ Báo giá ${q.code} đã được duyệt`, body: 'Có thể gửi cho khách.', link: `/bao-gia/${q.id}` });
    }
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

// ---------- send / accept / reject / expire ----------

export const SendQuoteInput = z.object({
  /** MESSENGER: send the PDF in this conversation. MANUAL: sales sends the PDF themselves (Zalo, email). */
  via: z.enum(['MESSENGER', 'MANUAL']).default('MANUAL'),
  conversationId: z.string().optional(),
});

/** Move the quote's deal to BAO_GIA (never backwards), creating it for the open lead if needed. */
async function dealToQuoteStage(tx: Tx, ctx: ServiceContext, q: { id: string; customerId: string; dealId: string | null; ownerId: string }, now: Date, actorId: string) {
  const stage = await tx.pipelineStage.findFirst({ where: { orgId: ctx.orgId, code: 'BAO_GIA' } });
  if (!stage) return null;
  let deal = q.dealId ? await tx.deal.findFirst({ where: { id: q.dealId }, include: { stage: true } }) : null;
  if (!deal) {
    const lead = await tx.lead.findFirst({ where: { customerId: q.customerId, status: 'IN_PROGRESS', deletedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!lead) return null;
    deal = await tx.deal.findFirst({ where: { leadId: lead.id, closedAt: null, deletedAt: null }, include: { stage: true }, orderBy: { createdAt: 'desc' } });
    if (!deal) {
      const c = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId }, select: { shopName: true, contactName: true } });
      deal = await tx.deal.create({ data: { orgId: ctx.orgId, leadId: lead.id, customerId: q.customerId, ownerId: lead.ownerId ?? q.ownerId, stageId: stage.id, title: c.shopName ?? c.contactName, createdAt: now }, include: { stage: true } });
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: q.customerId, leadId: lead.id, userId: actorId, type: 'STAGE_CHANGE', data: { from: null, to: stage.code, toName: stage.name, quoteId: q.id }, createdAt: now } });
    }
  }
  if (!deal.closedAt && deal.stage.order < stage.order) {
    await tx.deal.update({ where: { id: deal.id }, data: { stageId: stage.id } });
    await tx.activity.create({ data: { orgId: ctx.orgId, customerId: q.customerId, leadId: deal.leadId, userId: actorId, type: 'STAGE_CHANGE', data: { from: deal.stage.code, to: stage.code, toName: stage.name, quoteId: q.id }, createdAt: now } });
  }
  await tx.lead.updateMany({ where: { id: deal.leadId }, data: { lastActivityAt: now } });
  return deal;
}

export async function sendQuote(ctx: ServiceContext, quoteId: string, raw: z.input<typeof SendQuoteInput> = {}) {
  const input = SendQuoteInput.parse(raw);
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const { actor, q } = await loadQuote(tx, ctx, quoteId);
    assertAuthorized(actor, 'quote.manage', q);
    if (q.status === 'PENDING_APPROVAL') throw new DomainError('INVALID_STATE', 'Báo giá đang chờ Owner duyệt chiết khấu');
    if (q.status !== 'DRAFT' && q.status !== 'SENT') throw new DomainError('INVALID_STATE', 'Báo giá đã đóng');
    const now = ctx.now();
    if (input.via === 'MESSENGER') {
      const conv = await tx.conversation.findFirst({
        where: { id: input.conversationId ?? '', orgId: ctx.orgId, customerId: q.customerId },
        include: { customer: { select: { ownerId: true } }, lead: { select: { ownerId: true } }, channelAccount: true },
      });
      if (!conv || !canAccessConversation(actor, conv, 'conversation.reply')) throw new DomainError('VALIDATION_ERROR', 'Không tìm thấy hội thoại Messenger của khách');
      const w = await conversationWindow(ctx.db, conv, now);
      if (!w.ok) throw new DomainError('INVALID_STATE', `${w.reason} Hãy tải PDF và gửi qua Zalo.`);
    }
    const settings = await getSettings(tx, ctx.orgId, ['quote.validDays', 'quote.followUpBusinessDays']);
    const firstSend = q.status === 'DRAFT';
    const updated = await tx.quote.update({
      where: { id: q.id },
      data: { status: 'SENT', sentAt: q.sentAt ?? now, ...(firstSend ? { validUntil: validUntilFrom(now, settings['quote.validDays']) } : {}) },
    });
    if (firstSend) {
      const deal = await dealToQuoteStage(tx, ctx, q, now, actor.id);
      if (deal && !q.dealId) await tx.quote.update({ where: { id: q.id }, data: { dealId: deal.id } });
      // "Follow-up báo giá" after N working days (6.6); autoRuleKey keeps it to exactly one task.
      const cal = await loadCalendar(tx, ctx.orgId);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId }, select: { shopName: true, contactName: true } });
      await tx.task.createMany({
        data: [{
          orgId: ctx.orgId, title: `Follow-up báo giá ${q.code} — ${customer.shopName ?? customer.contactName}`, type: 'FOLLOW_UP',
          dueAt: addBusinessDays(now, settings['quote.followUpBusinessDays'], cal), assigneeId: q.ownerId, createdById: actor.id,
          customerId: q.customerId, leadId: deal?.leadId ?? null, quoteId: q.id, autoRuleKey: `quote-followup:${q.id}`,
        }],
        skipDuplicates: true,
      });
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: q.customerId, leadId: deal?.leadId ?? null, userId: actor.id, type: 'QUOTE', data: { kind: 'sent', quoteId: q.id, code: q.code, total: Number(q.total), via: input.via }, createdAt: now } });
    }
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'quote.send', entityType: 'Quote', entityId: q.id, before: { status: q.status }, after: { status: 'SENT', via: input.via, conversationId: input.conversationId ?? null }, ip: ctx.ip });
    outbox.renderQuotePdf({ quoteId: q.id, sendToConversationId: input.via === 'MESSENGER' ? input.conversationId : null, userId: actor.id });
    outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: [q.ownerId], roles: MANAGERS }, data: { quoteId: q.id } });
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

export async function respondQuote(ctx: ServiceContext, quoteId: string, outcome: 'ACCEPTED' | 'REJECTED', reason?: string) {
  return ctx.db.$transaction(async (tx) => {
    const { actor, q } = await loadQuote(tx, ctx, quoteId);
    assertAuthorized(actor, 'quote.manage', q);
    if (q.status !== 'SENT' && !(outcome === 'ACCEPTED' && q.status === 'EXPIRED')) throw new DomainError('INVALID_STATE', 'Chỉ cập nhật được báo giá đã gửi');
    const updated = await tx.quote.update({ where: { id: q.id }, data: { status: outcome } });
    await tx.activity.create({ data: { orgId: ctx.orgId, customerId: q.customerId, userId: actor.id, type: 'QUOTE', data: { kind: outcome === 'ACCEPTED' ? 'accepted' : 'rejected', quoteId: q.id, code: q.code, reason: reason ?? null }, createdAt: ctx.now() } });
    // A customer replying to a quote closes the follow-up reminder.
    await tx.task.updateMany({ where: { autoRuleKey: `quote-followup:${q.id}`, status: 'TODO' }, data: { status: 'DONE', completedAt: ctx.now() } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: outcome === 'ACCEPTED' ? 'quote.accept' : 'quote.reject', entityType: 'Quote', entityId: q.id, before: { status: q.status }, after: { status: outcome, reason: reason ?? null }, ip: ctx.ip });
    return updated;
  }, TX_OPTIONS);
}

export const QuoteToOrderInput = z.object({
  paymentMethod: z.enum(['BANK_TRANSFER', 'CASH', 'CREDIT']).default('BANK_TRANSFER'),
  shippingAddress: z.string().trim().max(500).optional(),
  orderedAt: z.coerce.date().optional(),
  note: z.string().trim().max(2000).optional(),
});

/** "Báo giá ACCEPTED → chuyển thành Đơn sỉ bằng 1 nút" (6.6). A sent quote is accepted on the way. */
export async function quoteToOrder(ctx: ServiceContext, quoteId: string, raw: z.input<typeof QuoteToOrderInput> = {}) {
  const input = QuoteToOrderInput.parse(raw);
  const outbox = new Outbox(ctx.effects);
  const order = await ctx.db.$transaction(async (tx) => {
    const { actor, q } = await loadQuote(tx, ctx, quoteId);
    assertAuthorized(actor, 'quote.manage', q);
    if (q.status !== 'ACCEPTED' && q.status !== 'SENT') throw new DomainError('INVALID_STATE', 'Chỉ chuyển được báo giá đã gửi / khách đồng ý');
    const existing = await tx.order.findFirst({ where: { quoteId: q.id, deletedAt: null } });
    if (existing) throw new DomainError('CONFLICT', `Báo giá đã thành đơn ${existing.code}`, { orderId: existing.id });
    if (q.status === 'SENT') {
      await tx.quote.update({ where: { id: q.id }, data: { status: 'ACCEPTED' } });
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: q.customerId, userId: actor.id, type: 'QUOTE', data: { kind: 'accepted', quoteId: q.id, code: q.code }, createdAt: ctx.now() } });
    }
    await tx.task.updateMany({ where: { autoRuleKey: `quote-followup:${q.id}`, status: 'TODO' }, data: { status: 'DONE', completedAt: ctx.now() } });
    return createOrder(
      { ...ctx, effects: { ...ctx.effects, publish: async (e) => outbox.publish(e) } },
      {
        customerId: q.customerId, quoteId: q.id, dealId: q.dealId ?? undefined, shippingFee: Number(q.shippingFee), paymentMethod: input.paymentMethod,
        shippingAddress: input.shippingAddress, orderedAt: input.orderedAt, note: input.note,
        items: quoteItems(q.items).map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discount: computeLine(l).discount })),
      },
      { tx },
    );
  }, TX_OPTIONS);
  await outbox.flush();
  return order;
}

/** `quote-expiry` (hourly, §9): SENT quotes past validUntil → EXPIRED. */
export async function expireQuotes(ctx: ServiceContext) {
  const now = ctx.now();
  const due = await ctx.db.quote.findMany({ where: { orgId: ctx.orgId, status: 'SENT', validUntil: { lt: now } }, select: { id: true, code: true, customerId: true } });
  for (const q of due) {
    await ctx.db.$transaction(async (tx) => {
      const r = await tx.quote.updateMany({ where: { id: q.id, status: 'SENT' }, data: { status: 'EXPIRED' } });
      if (!r.count) return;
      await tx.activity.create({ data: { orgId: ctx.orgId, customerId: q.customerId, type: 'QUOTE', data: { kind: 'expired', quoteId: q.id, code: q.code }, createdAt: now } });
      await recordAudit(tx, { orgId: ctx.orgId, via: 'SYSTEM', action: 'quote.expire', entityType: 'Quote', entityId: q.id, before: { status: 'SENT' }, after: { status: 'EXPIRED' } });
    });
  }
  return { expired: due.length };
}

/** "Tạo đơn lặp lại" (6.8): copy the customer's latest order into a new draft quote at today's prices. */
export async function repeatOrderAsQuote(ctx: ServiceContext, orderId: string) {
  const actor = actorOf(ctx);
  const order = await ctx.db.order.findFirst({ where: { id: orderId, orgId: ctx.orgId, deletedAt: null }, include: { items: true } });
  if (!order || !authorize(actor, 'order.view', order)) throw notFound('đơn hàng');
  const qty = new Map<string, number>();
  for (const i of order.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + Math.max(1, Math.round(Number(i.qty))));
  return createQuote(ctx, { customerId: order.customerId, items: [...qty].map(([productId, q]) => ({ productId, qty: q })), shippingFee: Number(order.shippingFee) });
}

// ---------- read ----------

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess((v) => (typeof v === 'string' && v ? v.split(',') : v), z.array(z.enum(values)).optional());

export const QuoteListFilters = z.object({
  q: z.string().trim().max(100).optional(),
  status: csv(['DRAFT', 'PENDING_APPROVAL', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
  customerId: z.string().optional(),
  ownerId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function listQuotes(ctx: ServiceContext, raw: z.input<typeof QuoteListFilters>) {
  const actor = actorOf(ctx);
  const f = QuoteListFilters.parse(raw);
  const where: Prisma.QuoteWhereInput = { ...scopeFilter(actor, 'quote') };
  if (f.status?.length) where.status = { in: f.status as QuoteStatus[] };
  if (f.customerId) where.customerId = f.customerId;
  if (f.ownerId) where.ownerId = f.ownerId;
  if (f.q) where.OR = [{ code: { contains: f.q, mode: 'insensitive' } }, { customer: { OR: [{ contactName: { contains: f.q, mode: 'insensitive' } }, { shopName: { contains: f.q, mode: 'insensitive' } }] } }];
  const rows = await ctx.db.quote.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { customer: { select: { id: true, contactName: true, shopName: true } }, owner: { select: { id: true, fullName: true } }, orders: { select: { id: true, code: true } } },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

export async function getQuote(ctx: ServiceContext, quoteId: string) {
  const actor = actorOf(ctx);
  const q = await ctx.db.quote.findFirst({
    where: { id: quoteId, orgId: ctx.orgId },
    include: {
      customer: { select: { id: true, contactName: true, shopName: true, phone: true, address: true, province: true, taxCode: true, tier: true, priceListId: true, ownerId: true } },
      owner: { select: { id: true, fullName: true, phone: true, email: true } },
      deal: { include: { stage: true } },
      orders: { select: { id: true, code: true } },
    },
  });
  if (!q || !authorize(actor, 'quote.view', q)) throw notFound('báo giá');
  const conversations = await ctx.db.conversation.findMany({
    where: { customerId: q.customerId, channelAccount: { type: 'FACEBOOK_PAGE' } },
    include: { channelAccount: true, customer: { select: { ownerId: true } }, lead: { select: { ownerId: true } } },
    orderBy: { lastInboundAt: { sort: 'desc', nulls: 'last' } },
  });
  const now = ctx.now();
  const messenger = await Promise.all(
    conversations.filter((c) => canAccessConversation(actor, c, 'conversation.reply')).map(async (c) => ({ id: c.id, name: c.channelAccount.name, window: await conversationWindow(ctx.db, c, now) })),
  );
  return {
    quote: q,
    items: quoteItems(q.items),
    messenger,
    can: {
      edit: (q.status === 'DRAFT' || q.status === 'PENDING_APPROVAL') && authorize(actor, 'quote.manage', q),
      approve: q.status === 'PENDING_APPROVAL' && authorize(actor, 'quote.approve', q),
      send: (q.status === 'DRAFT' || q.status === 'SENT') && authorize(actor, 'quote.manage', q),
      respond: q.status === 'SENT' && authorize(actor, 'quote.manage', q),
      toOrder: (q.status === 'ACCEPTED' || q.status === 'SENT') && q.orders.length === 0 && authorize(actor, 'quote.manage', q),
    },
  };
}

// ---------- PDF ----------

export type QuotePdfRenderer = (data: QuotePdfData) => Promise<Buffer>;

async function fetchImage(url: string | null, timeoutMs = 4000): Promise<Buffer | null> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/image\/(png|jpe?g)/.test(type)) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null; // a missing thumbnail must never block the quote
  }
}

/** `quote-pdf` job body: render with the brand template, store privately, remember the key. */
export async function generateQuotePdf(rt: { db: ServiceContext['db']; now: () => Date }, quoteId: string, render: QuotePdfRenderer, storage: ObjectStorage, opts: { fetchImages?: boolean } = {}) {
  const q = await rt.db.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { customer: true, owner: { select: { fullName: true, phone: true, email: true } } },
  });
  const items = quoteItems(q.items);
  const images = opts.fetchImages === false ? [] : await Promise.all(items.map((l) => fetchImage(l.imageUrl)));
  const list = q.customer.priceListId ? await rt.db.priceList.findUnique({ where: { id: q.customer.priceListId } }) : null;
  const data: QuotePdfData = {
    code: q.code,
    createdAt: q.sentAt ?? q.createdAt,
    validUntil: q.validUntil,
    company: await getCompanyProfile(rt.db, q.orgId),
    customer: { name: q.customer.shopName ?? q.customer.contactName, contactName: q.customer.contactName, phone: q.customer.phone, address: q.customer.address, province: q.customer.province, taxCode: q.customer.taxCode },
    sales: { name: q.owner.fullName, phone: q.owner.phone, email: q.owner.email },
    lines: items.map((l, i) => ({ no: i + 1, sku: l.sku, name: l.name, unit: l.unit, unitsPerCase: l.unitsPerCase, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, lineTotal: l.lineTotal, image: images[i] ?? null })),
    subtotal: Number(q.subtotal),
    discount: Number(q.discount),
    shippingFee: Number(q.shippingFee),
    total: Number(q.total),
    terms: q.terms,
    priceListName: list?.name ?? null,
  };
  const pdf = await render(data);
  const key = storageKey(q.orgId, 'quotes', `${q.code}.pdf`, rt.now());
  await storage.put(key, pdf, 'application/pdf');
  await rt.db.quote.update({ where: { id: q.id }, data: { pdfKey: key } });
  return { key, size: pdf.length, code: q.code };
}

/** After rendering: send the PDF in the customer's Messenger thread as the sales who pressed "Gửi". */
export async function sendQuotePdfToConversation(ctx: ServiceContext, quoteId: string, conversationId: string, linkTtlSeconds: number) {
  const { q } = await loadQuote(ctx.db, ctx, quoteId);
  if (!q.pdfKey) throw new DomainError('INVALID_STATE', 'PDF báo giá chưa sẵn sàng');
  const url = `${appUrl()}${signedFilePath(q.pdfKey, linkTtlSeconds)}`;
  return queueConversationMessages(ctx, conversationId, [
    { kind: 'text', text: `Em gửi anh/chị báo giá sỉ ${q.code} (tổng ${formatVnd(Number(q.total))}, hiệu lực đến ${q.validUntil.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}) ạ.`, idempotencyKey: `quote-${q.id}-${q.pdfKey}-text` },
    { kind: 'quote_pdf', attachmentUrl: url, meta: { quoteId: q.id, fileName: `${q.code}.pdf` }, idempotencyKey: `quote-${q.id}-${q.pdfKey}-file` },
  ]);
}
