import { deleteQuickReply, QuickReplyInput, saveQuickReply } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => saveQuickReply(ctx, params.id, await readJson(req, QuickReplyInput)));
export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteQuickReply(ctx, params.id);
  return { ok: true };
});
