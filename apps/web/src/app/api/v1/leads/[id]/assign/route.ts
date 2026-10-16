import { manualAssign } from '@michio/core';
import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';

const Body = z.object({ userId: z.string() });

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const [r] = await manualAssign(ctx, [params.id], (await readJson(req, Body)).userId);
  if (!r?.ok) throw new HttpError(409, 'INVALID_STATE', r?.error ?? 'Không giao được lead');
  return r;
});
