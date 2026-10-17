import { respondQuote } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().max(500).optional() }));
  return respondQuote(ctx, params.id, 'REJECTED', reason);
});
