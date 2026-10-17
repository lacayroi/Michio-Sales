import { ConversationPatch, getConversation, updateConversation } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ ctx, params }) => getConversation(ctx, params.id));

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => updateConversation(ctx, params.id, await readJson(req, ConversationPatch)));
