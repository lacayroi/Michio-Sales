import { revokeApiKey } from '@michio/core';
import { route } from '@/lib/api';

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await revokeApiKey(ctx, params.id);
  return { ok: true };
});
