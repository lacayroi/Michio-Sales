// Linking a staff account to the Zalo Bot (SPEC 5.5) and per-user notification preferences (6.12).
import { randomInt } from 'node:crypto';
import type { Prisma } from '@michio/db';
import { z } from 'zod';
import { recordAudit } from './audit';
import { type ServiceContext, TX_OPTIONS } from './context';
import { DomainError } from './errors';

export const LINK_CODE_TTL_MINUTES = 10;

/** Notification types a user can mute on Zalo. "Được giao lead" cannot be muted (SPEC 6.12). */
export const BOT_NOTIFICATION_TYPES = [
  { type: 'lead.assigned', label: 'Được giao lead', locked: true },
  { type: 'lead.expiring', label: 'Sắp hết hạn nhận lead' },
  { type: 'lead.reclaimed', label: 'Lead bị thu hồi' },
  { type: 'lead.recontact', label: 'Khách liên hệ lại' },
  { type: 'lead.contact_overdue', label: 'Quá hạn liên hệ đầu tiên' },
  { type: 'task.due', label: 'Nhắc việc đến hạn' },
  { type: 'daily.digest', label: 'Tổng kết 08:00 mỗi sáng' },
  { type: 'lead.queued', label: 'Lead chưa có người nhận (quản lý)' },
] as const;

export type NotificationPrefs = { zalo?: Record<string, boolean> };

export function zaloEnabled(prefs: unknown, type: string): boolean {
  if (type === 'lead.assigned') return true;
  const p = (prefs ?? {}) as NotificationPrefs;
  return p.zalo?.[type] !== false;
}

function requireActor(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

/** "Kết nối Zalo Bot": a 6-digit code valid 10 minutes; the user sends it to the bot. */
export async function createBotLinkCode(ctx: ServiceContext) {
  const actor = requireActor(ctx);
  const expiresAt = new Date(ctx.now().getTime() + LINK_CODE_TTL_MINUTES * 60_000);
  return ctx.db.$transaction(async (tx) => {
    await tx.botLinkCode.deleteMany({ where: { OR: [{ userId: actor.id }, { expiresAt: { lt: ctx.now() } }] } });
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const clash = await tx.botLinkCode.findUnique({ where: { code } });
      if (clash) continue;
      await tx.botLinkCode.create({ data: { code, userId: actor.id, expiresAt } });
      return { code, expiresAt };
    }
    throw new DomainError('CONFLICT', 'Không tạo được mã, vui lòng thử lại');
  }, TX_OPTIONS);
}

/** Called by the bot when an unknown chat sends a 6-digit code. */
export async function linkBotChat(db: ServiceContext['db'], code: string, chatId: string, now: Date) {
  return db.$transaction(async (tx) => {
    const link = await tx.botLinkCode.findUnique({ where: { code }, include: { user: true } });
    if (!link || link.expiresAt < now) return { ok: false as const, reason: 'Mã không đúng hoặc đã hết hạn (10 phút). Hãy lấy mã mới trong Hồ sơ.' };
    const user = link.user;
    if (user.deletedAt || user.status === 'INACTIVE') return { ok: false as const, reason: 'Tài khoản đã bị khóa.' };
    // One Zalo chat ↔ one account: a chat re-linked to another account leaves the old one.
    const previous = await tx.user.findUnique({ where: { zaloBotChatId: chatId }, select: { id: true } });
    if (previous && previous.id !== user.id) await tx.user.update({ where: { id: previous.id }, data: { zaloBotChatId: null } });
    await tx.user.update({ where: { id: user.id }, data: { zaloBotChatId: chatId } });
    await tx.botLinkCode.deleteMany({ where: { userId: user.id } });
    await recordAudit(tx, {
      orgId: user.orgId, actorId: user.id, via: 'ZALO_BOT', action: 'user.zaloBot.link', entityType: 'User', entityId: user.id,
      before: { linked: Boolean(user.zaloBotChatId) }, after: { linked: true, replacedUserId: previous && previous.id !== user.id ? previous.id : null },
    });
    return { ok: true as const, user };
  }, TX_OPTIONS);
}

export async function unlinkBot(ctx: ServiceContext) {
  const actor = requireActor(ctx);
  await ctx.db.$transaction([
    ctx.db.user.update({ where: { id: actor.id }, data: { zaloBotChatId: null } }),
    recordAudit(ctx.db, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'user.zaloBot.unlink', entityType: 'User', entityId: actor.id, ip: ctx.ip }),
  ]);
}

export const NotificationPrefsInput = z.object({
  zalo: z.partialRecord(z.enum(BOT_NOTIFICATION_TYPES.map((t) => t.type) as [string, ...string[]]), z.boolean()),
});

export async function updateNotificationPrefs(ctx: ServiceContext, raw: z.input<typeof NotificationPrefsInput>) {
  const actor = requireActor(ctx);
  const input = NotificationPrefsInput.parse(raw);
  const zalo = { ...input.zalo, 'lead.assigned': true };
  const before = await ctx.db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { notificationPrefs: true } });
  const value = { ...((before.notificationPrefs ?? {}) as NotificationPrefs), zalo } as Prisma.InputJsonValue;
  await ctx.db.$transaction([
    ctx.db.user.update({ where: { id: actor.id }, data: { notificationPrefs: value } }),
    recordAudit(ctx.db, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'user.notificationPrefs', entityType: 'User', entityId: actor.id,
      before: (before.notificationPrefs ?? null) as Prisma.InputJsonValue, after: value, ip: ctx.ip,
    }),
  ]);
  return value;
}
