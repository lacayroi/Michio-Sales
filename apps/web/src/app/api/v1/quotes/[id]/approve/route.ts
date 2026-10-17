import { approveQuote } from '@michio/core';
import { route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ ctx, params }) => approveQuote(ctx, params.id));
