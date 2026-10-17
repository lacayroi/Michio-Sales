import { createQuote, listQuotes, QuoteInput } from '@michio/core';
import { readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listQuotes(ctx, searchParamsOf(req)));
export const POST = route(async ({ req, ctx }) => createQuote(ctx, await readJson(req, QuoteInput)), { status: 201 });
