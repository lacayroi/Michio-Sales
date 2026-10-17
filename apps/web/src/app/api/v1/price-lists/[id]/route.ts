import { PriceListInput, savePriceList } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => savePriceList(ctx, params.id, await readJson(req, PriceListInput)));
