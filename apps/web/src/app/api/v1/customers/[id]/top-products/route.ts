import { topProducts } from '@michio/core';
import { route } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ ctx, params }) => ({ items: await topProducts(ctx, params.id) }));
