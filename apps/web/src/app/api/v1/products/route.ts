import { searchProducts } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => searchProducts(ctx, searchParamsOf(req)));
