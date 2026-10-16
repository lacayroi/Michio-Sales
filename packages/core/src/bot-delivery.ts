// Deciding whether / when a Notification goes out on Zalo Bot (SPEC 5.5, 6.9, 6.12).
// The worker job `zalo-bot-notify` calls `prepareBotDelivery`, sends through packages/channels,
// then `markBotDelivered`. Pure decisions, so the rules are tested without a bot.
import type { PrismaClient } from '@michio/db';
import { zaloEnabled } from './bot-account';
import { addBusinessMinutes, isBusinessTime } from './business-time';
import { loadCalendar } from './calendar';
import { getSettings } from './settings';

/** Sent even outside working hours (SPEC 6.9: "không nhắn bot ngoài giờ trừ loại khẩn"). */
export const URGENT_TYPES = new Set(['lead.queued', 'lead.expiring', 'system']);
/** "Khách nhắn lại: tối đa 1 thông báo/khách/5 phút" (SPEC 5.5). */
export const RECONTACT_THROTTLE_MS = 5 * 60_000;
/** A "còn 3 phút" warning that could not go out in time is useless later. */
const STALE_AFTER_MS: Record<string, number> = { 'lead.expiring': 10 * 60_000 };

export type DeliveryDecision =
  | { action: 'send'; chatId: string; text: string }
  | { action: 'delay'; until: Date }
  | { action: 'skip'; reason: 'not-found' | 'already-sent' | 'not-linked' | 'inactive' | 'muted' | 'throttled' | 'stale' };

/** Title + body + deep link (SPEC 10.2: deep link từ Zalo Bot mở thẳng lead). */
export function formatBotMessage(n: { title: string; body: string; link: string | null }, appUrl?: string | null): string {
  const lines = [n.title.trim()];
  if (n.body.trim()) lines.push(n.body.trim());
  if (n.link && appUrl) lines.push(`👉 ${appUrl.replace(/\/$/, '')}${n.link}`);
  return lines.join('\n');
}

export async function prepareBotDelivery(db: PrismaClient, notificationId: string, now: Date, opts: { appUrl?: string | null } = {}): Promise<DeliveryDecision> {
  const n = await db.notification.findUnique({
    where: { id: notificationId },
    include: { user: { select: { orgId: true, zaloBotChatId: true, status: true, deletedAt: true, notificationPrefs: true } } },
  });
  if (!n) return { action: 'skip', reason: 'not-found' };
  if (n.sentZaloAt) return { action: 'skip', reason: 'already-sent' };
  const u = n.user;
  if (!u.zaloBotChatId) return { action: 'skip', reason: 'not-linked' };
  if (u.deletedAt || u.status === 'INACTIVE') return { action: 'skip', reason: 'inactive' };
  if (!zaloEnabled(u.notificationPrefs, n.type)) return { action: 'skip', reason: 'muted' };
  const staleAfter = STALE_AFTER_MS[n.type];
  if (staleAfter && now.getTime() - n.createdAt.getTime() > staleAfter) return { action: 'skip', reason: 'stale' };

  if (n.type === 'lead.recontact' && n.link) {
    const recent = await db.notification.findFirst({
      where: { userId: n.userId, type: 'lead.recontact', link: n.link, id: { not: n.id }, sentZaloAt: { gt: new Date(now.getTime() - RECONTACT_THROTTLE_MS) } },
      select: { id: true },
    });
    if (recent) return { action: 'skip', reason: 'throttled' };
  }

  if (!URGENT_TYPES.has(n.type)) {
    const { 'notify.zaloOutsideHours': outside } = await getSettings(db, u.orgId, ['notify.zaloOutsideHours']);
    if (!outside) {
      const cal = await loadCalendar(db, u.orgId);
      if (!isBusinessTime(now, cal)) return { action: 'delay', until: addBusinessMinutes(now, 0, cal) };
    }
  }
  return { action: 'send', chatId: u.zaloBotChatId, text: formatBotMessage(n, opts.appUrl) };
}

export async function markBotDelivered(db: PrismaClient, notificationId: string, at: Date) {
  await db.notification.updateMany({ where: { id: notificationId, sentZaloAt: null }, data: { sentZaloAt: at } });
}
