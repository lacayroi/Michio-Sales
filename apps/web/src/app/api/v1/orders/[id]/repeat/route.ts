// "Tạo đơn lặp lại" (SPEC 6.8): copies the order into a new draft quote at today's prices.
import { repeatOrderAsQuote } from '@michio/core';
import { route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ ctx, params }) => repeatOrderAsQuote(ctx, params.id), { status: 201 });
