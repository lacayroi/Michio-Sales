import { z } from 'zod';
import { readJson, route } from '@/lib/api';

export const POST = route(async ({ req, ctx, user }) => {
  const { ids } = await readJson(req, z.object({ ids: z.array(z.string()).max(200).optional() }));
  const r = await ctx.db.notification.updateMany({ where: { userId: user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  return { updated: r.count };
});
