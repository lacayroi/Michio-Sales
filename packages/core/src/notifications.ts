import type { Prisma } from '@michio/db';
import type { Outbox } from './context';

export interface NotificationInput {
  type: string; // lead.assigned | lead.expiring | lead.reclaimed | lead.recontact | lead.queued | lead.contact_overdue ...
  title: string;
  body: string;
  link?: string;
}

/** Creates in-app notifications (Zalo Bot delivery arrives in M2) and publishes them after commit. */
export async function notifyUsers(
  tx: Prisma.TransactionClient,
  outbox: Outbox,
  orgId: string,
  userIds: string[],
  input: NotificationInput,
) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await tx.notification.createMany({ data: unique.map((userId) => ({ userId, ...input })) });
  outbox.publish({ type: 'notification.new', orgId, audience: { userIds: unique }, data: { type: input.type, title: input.title } });
}

/** Active OWNER/MANAGER ids — recipients of escalations ("báo Owner"). */
export async function managerIds(tx: Prisma.TransactionClient, orgId: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { orgId, role: { in: ['OWNER', 'MANAGER'] }, deletedAt: null, status: { not: 'INACTIVE' } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
