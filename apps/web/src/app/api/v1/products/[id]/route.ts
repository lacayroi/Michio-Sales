import { ProductPatch, updateProduct } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => updateProduct(ctx, params.id, await readJson(req, ProductPatch)));
