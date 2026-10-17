import { SendQuoteInput, sendQuote } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => sendQuote(ctx, params.id, await readJson(req, SendQuoteInput)));
