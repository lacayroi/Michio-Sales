import { ChangePasswordInput, changeOwnPassword } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route(async ({ req, ctx }) => {
  await changeOwnPassword(ctx, await readJson(req, ChangePasswordInput));
  return { ok: true };
});
