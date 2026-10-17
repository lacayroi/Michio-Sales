import { respondQuote } from '@michio/core';
import { route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ ctx, params }) => respondQuote(ctx, params.id, 'ACCEPTED'));
