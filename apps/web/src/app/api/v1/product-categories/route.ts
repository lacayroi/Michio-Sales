import { listProductCategories } from '@michio/core';
import { route } from '@/lib/api';

export const GET = route(async ({ ctx }) => ({ items: await listProductCategories(ctx) }));
