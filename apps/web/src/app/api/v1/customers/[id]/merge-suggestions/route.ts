import { suggestMerges } from '@michio/core';
import { route } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ ctx, params }) => ({ items: await suggestMerges(ctx, params.id) }));
