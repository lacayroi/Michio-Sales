// In-app notifications (SPEC 6.12): a row per recipient + an SSE `notification.new` after commit.
// Zalo Bot delivery is added in M2 on top of the same rows (`sentZaloAt`).
import type { Role } from '@michio/auth';
import type { Db, Tx } from './context';
import type { EffectBuffer } from './effects';

export type NotificationType =
  | 'lead.assigned'
  | 'lead.expiring'
  | 'lead.reclaimed'
  | 'lead.returned'
  | 'lead.queued'
  | 'lead.recontact'
  | 'lead.contactOverdue'
  | 'import.done'
  | 'system';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

export async function notifyUsers(tx: Tx, fx: EffectBuffer, orgId: string, userIds: string[], n: NotificationInput) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await tx.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
  fx.publish({ type: 'notification.new', orgId, userIds: ids, data: { type: n.type, title: n.title, body: n.body, link: n.link } });
}

/** Active Owner/Manager accounts — recipients of "báo Owner" alerts. */
export async function managerIds(db: Db | Tx, orgId: string, roles: Role[] = ['OWNER', 'MANAGER']): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { orgId, role: { in: roles }, deletedAt: null, status: { not: 'INACTIVE' } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function listNotifications(db: Db, userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 30, 100),
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(db: Db, userId: string, ids?: string[]) {
  await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}
