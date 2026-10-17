import { ResolveInput, resolvePrices } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route(async ({ req, ctx }) => resolvePrices(ctx, await readJson(req, ResolveInput)));
