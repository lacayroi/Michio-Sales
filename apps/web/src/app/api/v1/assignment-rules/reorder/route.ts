import { reorderRules } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

export const POST = route(async ({ req, ctx }) => {
  await reorderRules(ctx, (await readJson(req, z.object({ ids: z.array(z.string()).min(1) }))).ids);
  return { ok: true };
});
