import { disconnectFacebookPage } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

export const POST = route(async ({ req, ctx }) => {
  const { channelAccountId } = await readJson(req, z.object({ channelAccountId: z.string() }));
  await disconnectFacebookPage(ctx, channelAccountId);
  return { ok: true };
});
