import { listQuickReplies, QuickReplyInput, saveQuickReply } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route(async ({ ctx }) => ({ items: await listQuickReplies(ctx) }));
export const POST = route(async ({ req, ctx }) => saveQuickReply(ctx, null, await readJson(req, QuickReplyInput)), { status: 201 });
