import { createOrder, listOrders, OrderCreateInput } from '@michio/core';
import { readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listOrders(ctx, searchParamsOf(req)));
export const POST = route(async ({ req, ctx }) => createOrder(ctx, await readJson(req, OrderCreateInput)), { status: 201 });
