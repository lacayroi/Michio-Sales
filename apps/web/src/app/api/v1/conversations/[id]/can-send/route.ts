import { canSendConversation } from '@michio/core';
import { route } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ ctx, params }) => canSendConversation(ctx, params.id));
