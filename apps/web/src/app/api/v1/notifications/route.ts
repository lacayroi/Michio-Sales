import { route } from '@/lib/api';

export const GET = route(async ({ ctx, user }) => {
  const [items, unread] = await Promise.all([
    ctx.db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ctx.db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return { items, unread };
});
