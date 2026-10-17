// Hộp thư (S6, SPEC 6.4): conversation list & thread, internal notes with @mentions, quick replies,
// and the Facebook Page connection (SPEC 5.2 "Thiết lập").
import { assertAuthorized, scopeFilter } from '@michio/auth';
import type { ChannelType, Prisma } from '@michio/db';
import { normalizeVnPhone } from '@michio/shared';
import { z } from 'zod';
import { recordAudit } from './audit';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { encryptJson } from './crypto';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';
import { canAccessConversation, conversationWindow } from './messenger';
import { notifyUsers } from './notifications';

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export const ConversationFilters = z.object({
  /** mine = I hold the customer or the lead; unread; unanswered = last message is from the customer */
  view: z.enum(['all', 'mine', 'unread', 'unanswered']).default('all'),
  channel: z.enum(['FACEBOOK_PAGE', 'ZALO_COMPANY', 'ZALO_OA']).optional(),
  q: z.string().trim().max(100).optional(),
  resolved: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional()),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function listConversations(ctx: ServiceContext, raw: z.input<typeof ConversationFilters>) {
  const actor = actorOf(ctx);
  const f = ConversationFilters.parse(raw);
  const and: Prisma.ConversationWhereInput[] = [scopeFilter(actor, 'conversation')];
  if (f.view === 'mine') and.push({ OR: [{ customer: { ownerId: actor.id } }, { lead: { ownerId: actor.id } }] });
  if (f.view === 'unread') and.push({ unreadCount: { gt: 0 } });
  if (f.view === 'unanswered') and.push({ lastInboundAt: { not: null, gte: ctx.db.conversation.fields.lastMessageAt } });
  if (f.channel) and.push({ channelAccount: { type: f.channel as ChannelType } });
  if (f.resolved !== undefined) and.push({ isResolved: f.resolved });
  if (f.q) {
    const phone = normalizeVnPhone(f.q);
    and.push({
      customer: {
        OR: [
          { contactName: { contains: f.q, mode: 'insensitive' } },
          { shopName: { contains: f.q, mode: 'insensitive' } },
          ...(phone ? [{ phone }] : []),
        ],
      },
    });
  }
  const rows = await ctx.db.conversation.findMany({
    where: { AND: and },
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: {
      customer: { select: { id: true, contactName: true, shopName: true, avatarUrl: true, ownerId: true } },
      lead: { select: { id: true, code: true, status: true, ownerId: true, owner: { select: { fullName: true } } } },
      channelAccount: { select: { type: true, name: true } },
      messages: { where: { direction: { not: 'NOTE' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { direction: true, kind: true, text: true, createdAt: true, status: true } },
    },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

/** Total unread across conversations the user may see — the inbox badge (SPEC 6.4). */
export async function unreadConversationCount(ctx: ServiceContext) {
  const actor = actorOf(ctx);
  const r = await ctx.db.conversation.aggregate({ _count: true, where: { ...scopeFilter(actor, 'conversation'), unreadCount: { gt: 0 } } });
  return r._count;
}

const conversationInclude = {
  customer: {
    include: { owner: { select: { id: true, fullName: true, phone: true } }, identities: { include: { channelAccount: { select: { type: true, name: true } } } } },
  },
  lead: { include: { owner: { select: { id: true, fullName: true, phone: true } }, deals: { where: { deletedAt: null, closedAt: null }, include: { stage: true }, take: 1 } } },
  channelAccount: { select: { id: true, type: true, name: true, status: true } },
} satisfies Prisma.ConversationInclude;

export async function getConversation(ctx: ServiceContext, conversationId: string, opts: { before?: Date; limit?: number } = {}) {
  const actor = actorOf(ctx);
  const conv = await ctx.db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId }, include: conversationInclude });
  if (!conv || !canAccessConversation(actor, conv, 'conversation.view')) throw notFound('hội thoại');
  const limit = Math.min(opts.limit ?? 60, 200);
  const page = await ctx.db.message.findMany({
    where: { conversationId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: { sentBy: { select: { id: true, fullName: true } } },
  });
  const hasMore = page.length > limit;
  const messages = (hasMore ? page.slice(0, limit) : page).reverse();
  const window = await conversationWindow(ctx.db, { ...conv, channelAccount: conv.channelAccount }, ctx.now());
  return { conversation: conv, messages, hasMore, window, canReply: canAccessConversation(actor, conv, 'conversation.reply') };
}

/** GET /conversations/:id/can-send — the composer locks with this reason (SPEC 5.2, 6.4). */
export async function canSendConversation(ctx: ServiceContext, conversationId: string) {
  const actor = actorOf(ctx);
  const conv = await ctx.db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId }, include: { customer: { select: { ownerId: true, phone: true } }, lead: { select: { ownerId: true } }, channelAccount: true } });
  if (!conv || !canAccessConversation(actor, conv, 'conversation.view')) throw notFound('hội thoại');
  const w = await conversationWindow(ctx.db, conv, ctx.now());
  return w.ok ? { ok: true as const, mode: w.mode, closesAt: w.closesAt } : { ok: false as const, reason: w.reason, phone: conv.customer.phone };
}

export const ConversationPatch = z.object({ isResolved: z.boolean().optional(), read: z.literal(true).optional() });

export async function updateConversation(ctx: ServiceContext, conversationId: string, raw: z.input<typeof ConversationPatch>) {
  const actor = actorOf(ctx);
  const input = ConversationPatch.parse(raw);
  const conv = await ctx.db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId }, include: { customer: { select: { ownerId: true } }, lead: { select: { ownerId: true } } } });
  if (!conv || !canAccessConversation(actor, conv, 'conversation.view')) throw notFound('hội thoại');
  if (!canAccessConversation(actor, conv, 'conversation.reply')) throw new DomainError('VALIDATION_ERROR', 'Bạn không có quyền với hội thoại này');
  const data: Prisma.ConversationUpdateInput = {};
  if (input.read && conv.unreadCount) data.unreadCount = 0;
  if (input.isResolved !== undefined && input.isResolved !== conv.isResolved) data.isResolved = input.isResolved;
  if (!Object.keys(data).length) return conv;
  return ctx.db.conversation.update({ where: { id: conv.id }, data });
}

// ---------- internal notes (khách không thấy) ----------

export const NoteInput = z.object({
  text: z.string().trim().min(1, 'Ghi chú trống').max(4000),
  mentionUserIds: z.array(z.string()).max(10).optional(),
});

/** Internal note with @nhắc đồng nghiệp (SPEC 6.4): explicit ids from the picker, or "@Họ Tên" in the text. */
export async function addConversationNote(ctx: ServiceContext, conversationId: string, raw: z.input<typeof NoteInput>) {
  const actor = actorOf(ctx);
  const input = NoteInput.parse(raw);
  const conv = await ctx.db.conversation.findFirst({ where: { id: conversationId, orgId: ctx.orgId }, include: { customer: { select: { ownerId: true, contactName: true } }, lead: { select: { ownerId: true } } } });
  if (!conv || !canAccessConversation(actor, conv, 'conversation.view')) throw notFound('hội thoại');
  if (!canAccessConversation(actor, conv, 'conversation.reply')) throw new DomainError('VALIDATION_ERROR', 'Bạn không có quyền với hội thoại này');
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { orgId: ctx.orgId, deletedAt: null, status: { not: 'INACTIVE' } }, select: { id: true, fullName: true } });
    const text = fold(input.text);
    const mentioned = new Set(input.mentionUserIds?.filter((id) => users.some((u) => u.id === id)));
    for (const u of users) if (text.includes(`@${fold(u.fullName)}`)) mentioned.add(u.id);
    mentioned.delete(actor.id);
    const note = await tx.message.create({
      data: { conversationId: conv.id, direction: 'NOTE', kind: 'text', text: input.text, status: 'SENT', sentByUserId: actor.id, attachments: mentioned.size ? { mentions: [...mentioned] } : undefined, createdAt: ctx.now() },
    });
    if (mentioned.size) {
      const me = users.find((u) => u.id === actor.id)?.fullName ?? 'Đồng nghiệp';
      await notifyUsers(tx, outbox, ctx.orgId, [...mentioned], {
        type: 'conversation.mention',
        title: `🗒️ ${me} nhắc bạn trong hội thoại với ${conv.customer.contactName}`,
        body: input.text.slice(0, 200),
        link: `/hop-thu?c=${conv.id}`,
      });
    }
    outbox.publish({ type: 'message.new', orgId: ctx.orgId, audience: { userIds: [actor.id, ...mentioned], roles: MANAGERS }, data: { conversationId: conv.id } });
    return note;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

// ---------- quick replies (gõ "/") ----------

export const QuickReplyInput = z.object({
  shortcut: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i, 'Phím tắt chỉ gồm chữ không dấu, số, - và _'),
  content: z.string().trim().min(1).max(2000),
});

export { renderQuickReply } from '@michio/shared';

export async function listQuickReplies(ctx: ServiceContext) {
  actorOf(ctx);
  return ctx.db.quickReply.findMany({ where: { orgId: ctx.orgId }, orderBy: { shortcut: 'asc' } });
}

export async function saveQuickReply(ctx: ServiceContext, id: string | null, raw: z.input<typeof QuickReplyInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'settings.manage');
  const input = QuickReplyInput.parse(raw);
  const clash = await ctx.db.quickReply.findFirst({ where: { orgId: ctx.orgId, shortcut: input.shortcut, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw new DomainError('CONFLICT', `Phím tắt /${input.shortcut} đã tồn tại`);
  return ctx.db.$transaction(async (tx) => {
    const before = id ? await tx.quickReply.findFirst({ where: { id, orgId: ctx.orgId } }) : null;
    if (id && !before) throw notFound('mẫu trả lời');
    const row = id
      ? await tx.quickReply.update({ where: { id }, data: input })
      : await tx.quickReply.create({ data: { orgId: ctx.orgId, ...input, createdById: actor.id } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: id ? 'quickReply.update' : 'quickReply.create', entityType: 'QuickReply', entityId: row.id, before: before ? { shortcut: before.shortcut, content: before.content } : undefined, after: input, ip: ctx.ip });
    return row;
  });
}

export async function deleteQuickReply(ctx: ServiceContext, id: string) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'settings.manage');
  await ctx.db.$transaction(async (tx) => {
    const row = await tx.quickReply.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw notFound('mẫu trả lời');
    await tx.quickReply.delete({ where: { id } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'quickReply.delete', entityType: 'QuickReply', entityId: id, before: { shortcut: row.shortcut, content: row.content } });
  });
}

// ---------- Facebook Page connection (Owner, SPEC 5.2) ----------

export async function facebookStatus(ctx: ServiceContext) {
  assertAuthorized(actorOf(ctx), 'integration.manage');
  const pages = await ctx.db.channelAccount.findMany({ where: { orgId: ctx.orgId, type: 'FACEBOOK_PAGE' }, orderBy: { createdAt: 'asc' } });
  const [conversations, lastEvent, failed] = await Promise.all([
    ctx.db.conversation.groupBy({ by: ['channelAccountId'], where: { orgId: ctx.orgId, channelAccountId: { in: pages.map((p) => p.id) } }, _count: true }),
    ctx.db.webhookEvent.findFirst({ where: { source: 'facebook' }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
    ctx.db.webhookEvent.count({ where: { source: 'facebook', status: 'FAILED' } }),
  ]);
  return {
    pages: pages.map((p) => ({
      id: p.id, pageId: p.externalId, name: p.name, status: p.status, hasToken: Boolean(p.credentials), tokenExpiresAt: p.tokenExpiresAt,
      lastError: (p.meta as { lastError?: string } | null)?.lastError ?? null, mock: Boolean((p.meta as { mock?: boolean } | null)?.mock),
      conversations: conversations.find((c) => c.channelAccountId === p.id)?._count ?? 0, connectedAt: p.updatedAt,
    })),
    lastWebhookAt: lastEvent?.receivedAt ?? null,
    failedEvents: failed,
  };
}

export async function connectFacebookPage(ctx: ServiceContext, input: { pageId: string; name: string; pageToken: string; userTokenExpiresAt?: Date | null; mock?: boolean }) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'integration.manage');
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.channelAccount.findUnique({ where: { orgId_type_externalId: { orgId: ctx.orgId, type: 'FACEBOOK_PAGE', externalId: input.pageId } } });
    const credentials = encryptJson({ pageToken: input.pageToken, userTokenExpiresAt: input.userTokenExpiresAt?.toISOString() ?? null });
    const meta = { ...((before?.meta as object | null) ?? {}), mock: Boolean(input.mock), lastError: null, connectedById: actor.id };
    const account = await tx.channelAccount.upsert({
      where: { orgId_type_externalId: { orgId: ctx.orgId, type: 'FACEBOOK_PAGE', externalId: input.pageId } },
      // Page tokens derived from a long-lived user token do not expire (tokenExpiresAt stays null).
      create: { orgId: ctx.orgId, type: 'FACEBOOK_PAGE', externalId: input.pageId, name: input.name, status: 'ACTIVE', credentials, meta },
      update: { name: input.name, status: 'ACTIVE', credentials, meta },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'integration.facebook.connect', entityType: 'ChannelAccount', entityId: account.id,
      before: before ? { status: before.status, name: before.name } : undefined, after: { pageId: input.pageId, name: input.name, status: 'ACTIVE' }, ip: ctx.ip,
    });
    return account;
  });
}

export async function disconnectFacebookPage(ctx: ServiceContext, channelAccountId: string) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'integration.manage');
  return ctx.db.$transaction(async (tx) => {
    const a = await tx.channelAccount.findFirst({ where: { id: channelAccountId, orgId: ctx.orgId, type: 'FACEBOOK_PAGE' } });
    if (!a) throw notFound('Page');
    await tx.channelAccount.update({ where: { id: a.id }, data: { status: 'DISABLED', credentials: null } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'integration.facebook.disconnect', entityType: 'ChannelAccount', entityId: a.id, before: { status: a.status }, after: { status: 'DISABLED' }, ip: ctx.ip });
  });
}

/** Active colleagues for the @mention picker (names only). */
export async function listColleagues(ctx: ServiceContext) {
  actorOf(ctx);
  return ctx.db.user.findMany({
    where: { orgId: ctx.orgId, deletedAt: null, status: { not: 'INACTIVE' }, role: { in: ['OWNER', 'MANAGER', 'SALES', 'SUPPORT'] } },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: 'asc' },
  });
}
