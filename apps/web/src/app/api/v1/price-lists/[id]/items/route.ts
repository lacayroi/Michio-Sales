import { getPriceListItems, PriceItemInput, upsertPriceListItems } from '@michio/core';
import { z } from 'zod';
import { readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ req, ctx, params }) => getPriceListItems(ctx, params.id, { q: searchParamsOf(req).q }));

const Body = z.object({ items: z.array(z.union([PriceItemInput, z.object({ productId: z.string(), remove: z.literal(true) })])).min(1).max(2000) });

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => upsertPriceListItems(ctx, params.id, (await readJson(req, Body)).items));
