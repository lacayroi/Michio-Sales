import { listPriceLists, PriceListInput, savePriceList } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route(async ({ ctx }) => ({ items: await listPriceLists(ctx) }));
export const POST = route(async ({ req, ctx }) => savePriceList(ctx, null, await readJson(req, PriceListInput)), { status: 201 });
