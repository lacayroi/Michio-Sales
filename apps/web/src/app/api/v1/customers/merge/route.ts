import { mergeCustomers } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

const Body = z.object({ targetId: z.string(), sourceId: z.string() });

export const POST = route(async ({ req, ctx }) => {
  const b = await readJson(req, Body);
  return mergeCustomers(ctx, b.targetId, b.sourceId);
});
