import { completeTask } from '@michio/core';
import { route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ ctx, params }) => completeTask(ctx, { id: params.id }));
