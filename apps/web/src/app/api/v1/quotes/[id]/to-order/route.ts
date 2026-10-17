import { quoteToOrder, QuoteToOrderInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => quoteToOrder(ctx, params.id, await readJson(req, QuoteToOrderInput)), { status: 201 });
