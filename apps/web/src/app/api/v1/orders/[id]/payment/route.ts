import { PaymentInput, updateOrderPayment } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => updateOrderPayment(ctx, params.id, await readJson(req, PaymentInput)));
