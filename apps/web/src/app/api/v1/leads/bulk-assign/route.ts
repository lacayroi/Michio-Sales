import { manualAssign } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

const Body = z.object({ leadIds: z.array(z.string()).min(1).max(500), userId: z.string() });

export const POST = route(async ({ req, ctx }) => {
  const b = await readJson(req, Body);
  return { results: await manualAssign(ctx, b.leadIds, b.userId) };
});
