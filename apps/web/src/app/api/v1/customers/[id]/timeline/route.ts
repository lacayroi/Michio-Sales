import { getTimeline } from '@michio/core';
import { route } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ ctx, params }) => getTimeline(ctx, { customerId: params.id }));
