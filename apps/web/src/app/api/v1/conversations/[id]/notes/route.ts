import { addConversationNote, NoteInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => addConversationNote(ctx, params.id, await readJson(req, NoteInput)), { status: 201 });
