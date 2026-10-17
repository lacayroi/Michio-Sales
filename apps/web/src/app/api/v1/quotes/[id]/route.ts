import { getQuote, QuoteInput, updateQuote } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ ctx, params }) => getQuote(ctx, params.id));
export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => updateQuote(ctx, params.id, await readJson(req, QuoteInput)));
