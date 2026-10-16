import { unlinkBot } from '@michio/core';
import { route } from '@/lib/api';

/** Disconnect this account from the Zalo Bot. */
export const DELETE = route(async ({ ctx }) => {
  await unlinkBot(ctx);
  return { ok: true };
});
