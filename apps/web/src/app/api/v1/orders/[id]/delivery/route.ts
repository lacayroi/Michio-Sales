import { DeliveryInput, updateOrderDelivery } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => updateOrderDelivery(ctx, params.id, await readJson(req, DeliveryInput)));
