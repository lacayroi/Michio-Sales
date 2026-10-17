// Facebook Messenger & Lead Ads in, customer messages out (SPEC 5.2, 6.2, 6.4).
// Webhook → WebhookEvent (idempotent, replayable) → `channel-inbound` → processFacebookEvent.
// Replies: sendConversationMessage (QUEUED) → `channel-outbound` → deliverOutboundMessage → MessageGateway.
import { randomUUID } from 'node:crypto';
import { type AuthUser, scopeOf } from '@michio/auth';
import {
  createMessengerGateway,
  type FacebookClient,
  FacebookApiError,
  type FacebookEvent,
  facebookEventKey,
  type FbAttachment,
  mapLeadAdsFields,
  MessagingWindowClosedError,
  messengerWindow,
  parseFacebookWebhook,
  type WindowState,
} from '@michio/channels';
import { type ChannelAccount, Prisma, type PrismaClient } from '@michio/db';
import { mapBusinessModel, mapCategory, mapOrderBand } from '@michio/integrations';
import { normalizeVnPhone } from '@michio/shared';
import { recordAudit } from './audit';
import { Outbox, type Effects, type ServiceContext, TX_OPTIONS } from './context';
import { decryptJson } from './crypto';
import { DomainError } from './errors';
import { MANAGERS } from './events';
import { intakeLead } from './leads';
import { OPEN_LEAD_STATUSES } from './assignment';
import { managerIds, notifyUsers } from './notifications';
import { isMockIntegrations } from './runtime';
import { getSettings } from './settings';

export const FACEBOOK_SOURCE = 'facebook';
/** "Khách nhắn lại: tối đa 1 thông báo/khách/5 phút" (SPEC 5.5) — also applied to the web bell. */
const RECONTACT_NOTIFY_MS = 5 * 60_000;
/** Timeline shows message summaries, not every message (SPEC 6.9). */
const TIMELINE_MESSAGE_GAP_MS = 30 * 60_000;

export interface MessengerRuntime {
  db: PrismaClient;
  effects: Effects;
  now: () => Date;
  client: FacebookClient;
  /** Our Meta app id: echoes it sent are already stored. */
  appId?: string | null;
}

export interface FacebookCredentials {
  pageToken: string;
  userTokenExpiresAt?: string | null;
}

/** Decrypted page token. Seeded/demo pages have no credentials and only work with mocks. */
export function pageToken(account: Pick<ChannelAccount, 'credentials'>): string {
  if (account.credentials) return decryptJson<FacebookCredentials>(account.credentials).pageToken;
  if (isMockIntegrations()) return 'mock-page-token';
  throw new DomainError('INVALID_STATE', 'Page Facebook chưa có access token — hãy kết nối lại trong Cài đặt');
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

// ---------- ingest ----------

/**
 * Store each message / postback / leadgen once (Meta retries; SPEC 6.2 AC: webhook twice → 1 Message,
 * 1 Lead). Delivery/read receipts are applied directly. Returns the new event ids to enqueue.
 */
export async function ingestFacebookWebhook(db: PrismaClient, payload: unknown): Promise<{ eventIds: string[]; duplicates: number; receipts: number }> {
  const events = parseFacebookWebhook(payload);
  const eventIds: string[] = [];
  let duplicates = 0;
  let receipts = 0;
  for (const e of events) {
    if (e.kind === 'delivery' || e.kind === 'read') {
      receipts += await applyReceipt(db, e);
      continue;
    }
    const key = facebookEventKey(e)!;
    try {
      const ev = await db.webhookEvent.create({ data: { source: FACEBOOK_SOURCE, eventKey: key, payload: e as unknown as Prisma.InputJsonValue, status: 'RECEIVED' } });
      eventIds.push(ev.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      duplicates++;
    }
  }
  return { eventIds, duplicates, receipts };
}

async function applyReceipt(db: PrismaClient, e: Extract<FacebookEvent, { kind: 'delivery' | 'read' }>) {
  const account = await db.channelAccount.findFirst({ where: { type: 'FACEBOOK_PAGE', externalId: e.pageId } });
  if (!account) return 0;
  const r = await db.message.updateMany({
    where: {
      conversation: { channelAccountId: account.id, externalThreadId: e.psid },
      direction: 'OUT',
      status: 'SENT',
      OR: [{ createdAt: { lte: new Date(e.watermark) } }, ...(e.mids.length ? [{ externalMessageId: { in: e.mids } }] : [])],
    },
    data: { status: 'DELIVERED' },
  });
  return r.count;
}

/** Run one stored event. Re-running a processed event is a no-op (replay: `pnpm replay:webhook`). */
export async function processFacebookEvent(rt: MessengerRuntime, eventId: string) {
  const ev = await rt.db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.status === 'PROCESSED') return { skipped: true as const };
  const e = ev.payload as unknown as FacebookEvent;
  try {
    let result: Record<string, unknown>;
    if (e.kind === 'message' || e.kind === 'postback') result = await handleMessageEvent(rt, e);
    else if (e.kind === 'leadgen') result = await handleLeadgen(rt, e);
    else result = { ignored: e.kind };
    await rt.db.webhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', error: null, processedAt: rt.now() } });
    return { skipped: false as const, ...result };
  } catch (err) {
    await rt.db.webhookEvent.update({ where: { id: eventId }, data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 500) : String(err), processedAt: rt.now() } });
    throw err;
  }
}

async function pageAccount(db: PrismaClient, pageId: string) {
  const account = await db.channelAccount.findFirst({ where: { type: 'FACEBOOK_PAGE', externalId: pageId, status: { not: 'DISABLED' } } });
  if (!account) throw new DomainError('NOT_FOUND', `Page ${pageId} chưa được kết nối`);
  return account;
}

const systemCtx = (rt: MessengerRuntime, orgId: string): ServiceContext => ({ db: rt.db, effects: rt.effects, now: rt.now, actor: null, orgId, via: 'SYSTEM' });

function messageKind(text: string | null, attachments: FbAttachment[]): string {
  const a = attachments[0];
  if (!a) return 'text';
  if (a.type === 'sticker') return 'sticker';
  if (a.type === 'image') return 'image';
  return 'file';
}

export function messagePreview(m: { kind: string; text: string | null }): string {
  if (m.text) return m.text.length > 120 ? `${m.text.slice(0, 119)}…` : m.text;
  return { image: '[Ảnh]', sticker: '[Sticker]', file: '[Tệp]', quote_pdf: '[Báo giá PDF]', product: '[Sản phẩm]' }[m.kind] ?? '[Tin nhắn]';
}

async function handleMessageEvent(rt: MessengerRuntime, e: Extract<FacebookEvent, { kind: 'message' | 'postback' }>) {
  const account = await pageAccount(rt.db, e.pageId);
  const orgId = account.orgId;
  const at = new Date(e.timestamp);
  const text = e.kind === 'postback' ? e.title || e.payload : e.text;
  const attachments = e.kind === 'message' ? e.attachments : [];
  const kind = messageKind(text, attachments);

  if (e.kind === 'message' && e.isEcho) return handleEcho(rt, account, e, kind, at);

  // Who is this? Open lead for a known PSID → just a new message; otherwise intake (creates/dedupes lead).
  const identity = await rt.db.customerIdentity.findUnique({
    where: { channelAccountId_externalUserId: { channelAccountId: account.id, externalUserId: e.psid } },
    include: { customer: { select: { id: true, deletedAt: true } } },
  });
  let customerId = identity && !identity.customer.deletedAt ? identity.customer.id : null;
  let openLead = customerId
    ? await rt.db.lead.findFirst({ where: { customerId, status: { in: [...OPEN_LEAD_STATUSES] }, deletedAt: null }, orderBy: { createdAt: 'desc' } })
    : null;
  let createdLead = false;
  if (!openLead) {
    const profile = identity ? { name: identity.displayName, avatarUrl: null } : await rt.client.getProfile(e.psid, pageToken(account));
    const r = await intakeLead(systemCtx(rt, orgId), {
      source: 'FACEBOOK_MESSENGER',
      fullName: profile.name ?? `Khách Facebook ${e.psid.slice(-4)}`,
      identity: { channelAccountId: account.id, externalUserId: e.psid, displayName: profile.name ?? undefined },
      need: text ?? undefined,
    });
    customerId = r.customerId;
    createdLead = !r.duplicate;
    openLead = await rt.db.lead.findUnique({ where: { id: r.leadId } });
    if (profile.avatarUrl) await rt.db.customer.updateMany({ where: { id: r.customerId, avatarUrl: null }, data: { avatarUrl: profile.avatarUrl } });
  }
  if (!customerId || !openLead) throw new Error('intake did not return a lead');

  const outbox = new Outbox(rt.effects);
  const out = await rt.db.$transaction(async (tx) => {
    const conv = await tx.conversation.upsert({
      where: { channelAccountId_externalThreadId: { channelAccountId: account.id, externalThreadId: e.psid } },
      create: { orgId, channelAccountId: account.id, customerId: customerId!, leadId: openLead!.id, externalThreadId: e.psid },
      update: { customerId: customerId!, leadId: openLead!.id },
    });
    let message;
    try {
      message = await tx.message.create({
        data: {
          conversationId: conv.id, direction: 'IN', kind, text,
          attachments: attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : undefined,
          externalMessageId: e.mid, status: 'RECEIVED', createdAt: at,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { duplicate: true as const, conversationId: conv.id };
      throw err;
    }
    // Meta may deliver out of order: only move timestamps forward.
    await tx.$executeRaw`UPDATE "Conversation" SET "unreadCount" = "unreadCount" + 1, "isResolved" = false,
      "lastMessageAt" = GREATEST(COALESCE("lastMessageAt", ${at}), ${at}), "lastInboundAt" = GREATEST(COALESCE("lastInboundAt", ${at}), ${at})
      WHERE id = ${conv.id}`;
    await tx.lead.update({ where: { id: openLead!.id }, data: { lastActivityAt: rt.now() } });
    await summarizeInTimeline(tx, { orgId, customerId: customerId!, leadId: openLead!.id, conversationId: conv.id, type: 'MESSAGE_IN', preview: messagePreview({ kind, text }), at, userId: null });

    // Tell the person holding the lead (not for a brand-new lead: "được giao lead" already does).
    const ownerId = openLead!.ownerId;
    if (!createdLead && ownerId) {
      const link = `/hop-thu?c=${conv.id}`;
      const recent = await tx.notification.findFirst({ where: { userId: ownerId, type: 'lead.recontact', link, createdAt: { gt: new Date(rt.now().getTime() - RECONTACT_NOTIFY_MS) } }, select: { id: true } });
      if (!recent) {
        const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId! }, select: { contactName: true } });
        await notifyUsers(tx, outbox, orgId, [ownerId], {
          type: 'lead.recontact',
          title: `💬 ${c.contactName} vừa nhắn: "${messagePreview({ kind, text }).slice(0, 80)}"`,
          body: `Facebook Messenger · lead #${openLead!.code}`,
          link,
        });
      }
    }
    outbox.publish({ type: 'message.new', orgId, audience: { userIds: ownerId ? [ownerId] : [], roles: MANAGERS }, data: { conversationId: conv.id, messageId: message.id } });
    return { duplicate: false as const, conversationId: conv.id, messageId: message.id };
  }, TX_OPTIONS);
  await outbox.flush();
  return { ...out, leadId: openLead.id, createdLead };
}

/** Page replied outside our app (Page inbox / Business Suite): keep the thread complete. */
async function handleEcho(rt: MessengerRuntime, account: ChannelAccount, e: Extract<FacebookEvent, { kind: 'message' }>, kind: string, at: Date) {
  if (rt.appId && e.appId === rt.appId) return { echo: 'own-app' };
  const conv = await rt.db.conversation.findUnique({ where: { channelAccountId_externalThreadId: { channelAccountId: account.id, externalThreadId: e.psid } }, include: { lead: true } });
  if (!conv) return { echo: 'unknown-thread' };
  try {
    await rt.db.message.create({
      data: {
        conversationId: conv.id, direction: 'OUT', kind, text: e.text,
        attachments: e.attachments.length ? (e.attachments as unknown as Prisma.InputJsonValue) : undefined,
        externalMessageId: e.mid, status: 'SENT', createdAt: at,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { echo: 'duplicate' };
    throw err;
  }
  await rt.db.$executeRaw`UPDATE "Conversation" SET "unreadCount" = 0, "lastMessageAt" = GREATEST(COALESCE("lastMessageAt", ${at}), ${at}) WHERE id = ${conv.id}`;
  if (conv.lead && !conv.lead.firstContactAt && conv.lead.status === 'IN_PROGRESS') {
    await rt.db.lead.update({ where: { id: conv.lead.id }, data: { firstContactAt: at, lastActivityAt: at } });
  }
  return { echo: 'stored' };
}

async function summarizeInTimeline(
  tx: Prisma.TransactionClient,
  a: { orgId: string; customerId: string; leadId: string | null; conversationId: string; type: 'MESSAGE_IN' | 'MESSAGE_OUT'; preview: string; at: Date; userId: string | null },
) {
  const recent = await tx.activity.findFirst({
    where: { customerId: a.customerId, type: a.type, createdAt: { gt: new Date(a.at.getTime() - TIMELINE_MESSAGE_GAP_MS) }, data: { path: ['conversationId'], equals: a.conversationId } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) {
    const d = recent.data as { count?: number };
    await tx.activity.update({ where: { id: recent.id }, data: { data: { ...(recent.data as object), count: (d.count ?? 1) + 1, last: a.preview } } });
    return;
  }
  await tx.activity.create({
    data: { orgId: a.orgId, customerId: a.customerId, leadId: a.leadId, userId: a.userId, type: a.type, data: { conversationId: a.conversationId, channel: 'FACEBOOK_PAGE', preview: a.preview, count: 1 }, createdAt: a.at },
  });
}

async function handleLeadgen(rt: MessengerRuntime, e: Extract<FacebookEvent, { kind: 'leadgen' }>) {
  const account = await pageAccount(rt.db, e.pageId);
  const lead = await rt.client.getLead(e.leadgenId, pageToken(account));
  const f = mapLeadAdsFields(lead.fields);
  const phone = f.phone && normalizeVnPhone(f.phone) ? f.phone : undefined;
  const extra = [f.note, f.interest && `Quan tâm: ${f.interest}`, f.phone && !phone && `SĐT khách nhập: ${f.phone}`].filter(Boolean).join(' · ');
  const r = await intakeLead(systemCtx(rt, account.orgId), {
    source: 'FACEBOOK_LEAD_ADS',
    fullName: f.fullName ?? 'Khách Lead Ads',
    phone,
    email: f.email && /.+@.+\..+/.test(f.email) ? f.email : undefined,
    province: f.province,
    shopName: f.shopName,
    businessModel: (mapBusinessModel(f.businessModel) ?? undefined) as never,
    expectedOrderBand: (mapOrderBand(f.expectedOrderBand) ?? undefined) as never,
    interestCategories: f.interest ? f.interest.split(/[,;]/).map((x) => mapCategory(x.trim())).filter((x): x is string => !!x) : undefined,
    need: extra || undefined,
    campaign: lead.formId ? `leadads-form-${lead.formId}` : undefined,
    formPayload: { leadgenId: lead.id, formId: lead.formId, adId: lead.adId, createdTime: lead.createdTime, fields: lead.fields },
  });
  return { leadId: r.leadId, duplicate: r.duplicate };
}

// ---------- access & window ----------

type ConvForAccess = { orgId: string; customer: { ownerId: string | null }; lead: { ownerId: string | null } | null };

/** conversation.view / reply: ALL for Owner/Manager; OWN = the customer's or the lead's owner (SPEC §3). */
export function canAccessConversation(actor: AuthUser, conv: ConvForAccess, action: 'conversation.view' | 'conversation.reply'): boolean {
  if (actor.status === 'INACTIVE' || actor.deletedAt) return false;
  const scope = scopeOf(actor.role, action);
  if (!scope || conv.orgId !== actor.orgId) return false;
  return scope === 'ALL' || conv.customer.ownerId === actor.id || conv.lead?.ownerId === actor.id;
}

export async function windowPolicy(db: Pick<PrismaClient, 'setting'> | Prisma.TransactionClient, orgId: string) {
  const s = await getSettings(db, orgId, ['facebook.standardWindowHours', 'facebook.humanAgentWindowDays', 'facebook.useHumanAgentTag']);
  return { standardWindowHours: s['facebook.standardWindowHours'], humanAgentWindowDays: s['facebook.humanAgentWindowDays'], useHumanAgentTag: s['facebook.useHumanAgentTag'] };
}

export async function conversationWindow(db: PrismaClient, conv: { orgId: string; lastInboundAt: Date | null; channelAccount: { type: string; status: string } }, now: Date): Promise<WindowState> {
  if (conv.channelAccount.type !== 'FACEBOOK_PAGE') return { ok: false, reason: 'Kênh này chưa hỗ trợ gửi tin từ hệ thống' };
  if (conv.channelAccount.status !== 'ACTIVE') return { ok: false, reason: 'Kết nối Facebook đang lỗi hoặc đã tắt — báo Owner kết nối lại' };
  return messengerWindow(conv.lastInboundAt, now, await windowPolicy(db, conv.orgId));
}

/** MessageGateway for a runtime: page tokens and windows come from the database. */
export function messengerGateway(rt: MessengerRuntime) {
  return createMessengerGateway({
    client: rt.client,
    async pageOf(channelAccountId) {
      const a = await rt.db.channelAccount.findUniqueOrThrow({ where: { id: channelAccountId } });
      return { pageId: a.externalId, pageToken: pageToken(a) };
    },
    async windowOf(conversationId) {
      const c = await rt.db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { channelAccount: true } });
      return conversationWindow(rt.db, c, rt.now());
    },
    async windowForRecipient(channelAccountId, psid) {
      const c = await rt.db.conversation.findUniqueOrThrow({ where: { channelAccountId_externalThreadId: { channelAccountId, externalThreadId: psid } }, include: { channelAccount: true } });
      return conversationWindow(rt.db, c, rt.now());
    },
  });
}

// ---------- outbound ----------

export interface OutboundInput {
  kind?: 'text' | 'image' | 'file' | 'quote_pdf' | 'product';
  text?: string;
  attachmentUrl?: string;
  /** For the timeline / UI: file name, product id, quote id… */
  meta?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Queue one outbound message (SPEC 6.4). Checks permission and the Messenger window before anything
 * is stored; the worker sends it through the MessageGateway with retries.
 */
export async function queueConversationMessages(ctx: ServiceContext, conversationId: string, inputs: OutboundInput[]) {
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  if (!inputs.length) throw new DomainError('VALIDATION_ERROR', 'Không có nội dung để gửi');
  const conv = await ctx.db.conversation.findFirst({
    where: { id: conversationId, orgId: ctx.orgId },
    include: { customer: { select: { id: true, ownerId: true } }, lead: { select: { id: true, ownerId: true, status: true } }, channelAccount: true },
  });
  if (!conv || !canAccessConversation(actor, conv, 'conversation.view')) throw new DomainError('NOT_FOUND', 'Không tìm thấy hội thoại');
  if (!canAccessConversation(actor, conv, 'conversation.reply')) throw new DomainError('VALIDATION_ERROR', 'Bạn không có quyền nhắn hội thoại này');
  const window = await conversationWindow(ctx.db, conv, ctx.now());
  if (!window.ok) throw new DomainError('INVALID_STATE', window.reason, { window });

  const outbox = new Outbox(ctx.effects);
  const messages = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const out = [];
    for (const [i, input] of inputs.entries()) {
      const key = input.idempotencyKey ? `${input.idempotencyKey}:${i}` : randomUUID();
      const existing = await tx.message.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        out.push(existing);
        continue;
      }
      if ((input.kind ?? 'text') === 'text' && !input.text?.trim()) throw new DomainError('VALIDATION_ERROR', 'Tin nhắn trống');
      out.push(
        await tx.message.create({
          data: {
            conversationId: conv.id, direction: 'OUT', kind: input.kind ?? 'text', text: input.text?.trim() || null,
            attachments: input.attachmentUrl || input.meta ? ({ url: input.attachmentUrl ?? null, ...input.meta } as Prisma.InputJsonValue) : undefined,
            status: 'QUEUED', sentByUserId: actor.id, idempotencyKey: key, createdAt: new Date(now.getTime() + i),
          },
        }),
      );
    }
    const fresh = out.filter((m) => m.status === 'QUEUED');
    if (fresh.length) {
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now, unreadCount: 0 } });
      await summarizeInTimeline(tx, { orgId: ctx.orgId, customerId: conv.customerId, leadId: conv.leadId, conversationId: conv.id, type: 'MESSAGE_OUT', preview: messagePreview(fresh[fresh.length - 1]!), at: now, userId: actor.id });
      if (conv.leadId) await tx.lead.update({ where: { id: conv.leadId }, data: { lastActivityAt: now } });
      outbox.sendOutbound(fresh.map((m) => m.id));
      outbox.publish({ type: 'message.new', orgId: ctx.orgId, audience: { userIds: [actor.id], roles: MANAGERS }, data: { conversationId: conv.id } });
    }
    return out;
  }, TX_OPTIONS);
  await outbox.flush();
  return { messages, window };
}

export type OutboundResult = { status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string };

/**
 * `channel-outbound` job body. Retryable failures rethrow so BullMQ retries (5×, backoff); on the
 * last attempt the message becomes FAILED and the sender is told. The first message actually sent
 * on a lead counts as first contact (SPEC 6.3.4 onFirstContact).
 */
export async function deliverOutboundMessage(rt: MessengerRuntime, messageId: string, opts: { finalAttempt: boolean }): Promise<OutboundResult> {
  const msg = await rt.db.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { channelAccount: true, lead: true, customer: { select: { contactName: true } } } } },
  });
  if (!msg || msg.status !== 'QUEUED' || msg.direction !== 'OUT') return { status: 'SKIPPED' };
  const conv = msg.conversation;
  const att = (msg.attachments ?? {}) as { url?: string | null };
  const kind = msg.kind === 'image' ? 'image' : msg.kind === 'file' || msg.kind === 'quote_pdf' ? (att.url ? 'file' : 'text') : 'text';
  try {
    const r = await messengerGateway(rt).send({
      channelAccountId: conv.channelAccountId,
      externalUserId: conv.externalThreadId,
      kind,
      text: msg.text ?? undefined,
      attachmentUrl: att.url ?? undefined,
      idempotencyKey: msg.idempotencyKey ?? msg.id,
    });
    const now = rt.now();
    await rt.db.$transaction(async (tx) => {
      await tx.message.update({ where: { id: msg.id }, data: { status: 'SENT', externalMessageId: r.externalMessageId, error: null } });
      const lead = conv.lead;
      if (lead && !lead.firstContactAt && lead.status === 'IN_PROGRESS') {
        await tx.lead.update({ where: { id: lead.id }, data: { firstContactAt: now, lastActivityAt: now } });
        await recordAudit(tx, {
          orgId: conv.orgId, actorId: msg.sentByUserId, via: 'WEB', action: 'lead.first_contact', entityType: 'Lead', entityId: lead.id,
          before: { firstContactAt: null }, after: { firstContactAt: now.toISOString(), messageId: msg.id, channel: 'FACEBOOK_PAGE' },
        });
      }
    });
    await rt.effects.publish({ type: 'message.new', orgId: conv.orgId, audience: { userIds: msg.sentByUserId ? [msg.sentByUserId] : [], roles: MANAGERS }, data: { conversationId: conv.id, messageId: msg.id, status: 'SENT' } });
    return { status: 'SENT' };
  } catch (err) {
    const fb = err instanceof FacebookApiError ? err : null;
    const permanent = err instanceof MessagingWindowClosedError || err instanceof DomainError || (fb && !fb.retryable);
    if (!permanent && !opts.finalAttempt) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    const outbox = new Outbox(rt.effects);
    await rt.db.$transaction(async (tx) => {
      await tx.message.update({ where: { id: msg.id }, data: { status: 'FAILED', error: reason.slice(0, 500) } });
      if (msg.sentByUserId) {
        await notifyUsers(tx, outbox, conv.orgId, [msg.sentByUserId], {
          type: 'message.failed',
          title: `⚠️ Không gửi được tin cho ${conv.customer.contactName}`,
          body: reason.slice(0, 200),
          link: `/hop-thu?c=${conv.id}`,
        });
      }
      if (fb?.authProblem) await markChannelError(tx, outbox, conv.channelAccount, reason);
    });
    outbox.publish({ type: 'message.new', orgId: conv.orgId, audience: { userIds: msg.sentByUserId ? [msg.sentByUserId] : [], roles: MANAGERS }, data: { conversationId: conv.id, messageId: msg.id, status: 'FAILED' } });
    await outbox.flush();
    return { status: 'FAILED', error: reason };
  }
}

/** Channel broken (token expired/revoked): status ERROR + "Cảnh báo cho Owner" (SPEC 5.5) once. */
async function markChannelError(tx: Prisma.TransactionClient, outbox: Outbox, account: ChannelAccount, reason: string) {
  if (account.status === 'ERROR') return;
  await tx.channelAccount.update({ where: { id: account.id }, data: { status: 'ERROR', meta: { ...((account.meta as object) ?? {}), lastError: reason.slice(0, 300) } } });
  await notifyUsers(tx, outbox, account.orgId, await managerIds(tx, account.orgId), {
    type: 'system',
    title: `🚨 Kết nối ${account.name} bị lỗi`,
    body: `${reason.slice(0, 200)} — vào Cài đặt → Facebook để kết nối lại.`,
    link: '/cai-dat/facebook',
  });
}

/** `facebook-token-check` (daily, SPEC §9): broken tokens → ERROR + Owner alert; fixed → ACTIVE. */
export async function checkFacebookTokens(rt: MessengerRuntime, orgId: string) {
  const accounts = await rt.db.channelAccount.findMany({ where: { orgId, type: 'FACEBOOK_PAGE', status: { in: ['ACTIVE', 'ERROR'] } } });
  const results = [];
  for (const a of accounts) {
    let check: { ok: true; name: string } | { ok: false; error: string };
    try {
      check = await rt.client.checkPageToken(a.externalId, pageToken(a));
    } catch (err) {
      check = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const outbox = new Outbox(rt.effects);
    if (!check.ok) {
      await rt.db.$transaction((tx) => markChannelError(tx, outbox, a, check.error));
    } else if (a.status === 'ERROR') {
      await rt.db.channelAccount.update({ where: { id: a.id }, data: { status: 'ACTIVE' } });
    }
    await outbox.flush();
    results.push({ id: a.id, ok: check.ok });
  }
  return results;
}

/** "Gửi link sản phẩm / ảnh sản phẩm chọn từ danh mục" (SPEC 6.4): photo (if any) + name, SKU, link. */
export async function buildProductMessages(ctx: ServiceContext, productId: string): Promise<OutboundInput[]> {
  const p = await ctx.db.product.findFirst({ where: { id: productId, orgId: ctx.orgId, isActive: true } });
  if (!p) throw new DomainError('NOT_FOUND', 'Không tìm thấy sản phẩm');
  const lines = [p.name, `Mã: ${p.sku}${p.unitsPerCase ? ` · Quy cách: ${p.unitsPerCase} ${p.unit ?? 'sp'}/thùng` : ''}`, ...(p.inStock ? [] : ['(Tạm hết hàng)']), ...(p.productUrl ? [p.productUrl] : [])];
  const meta = { productId: p.id, sku: p.sku };
  return [
    ...(p.imageUrl ? [{ kind: 'image' as const, attachmentUrl: p.imageUrl, meta }] : []),
    { kind: 'product' as const, text: lines.join('\n'), meta },
  ];
}
