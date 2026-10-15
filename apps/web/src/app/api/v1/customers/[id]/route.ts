import { CustomerUpdateInput, getCustomerDetail, updateCustomer } from '@michio/core';
import { readJson, route } from '@/lib/api';

type P = { id: string };
export const GET = route<P>(async ({ ctx, params }) => getCustomerDetail(ctx, params.id));
export const PATCH = route<P>(async ({ req, ctx, params }) => updateCustomer(ctx, params.id, await readJson(req, CustomerUpdateInput)));
