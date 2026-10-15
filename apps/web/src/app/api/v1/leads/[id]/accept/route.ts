import { acceptLead } from '@michio/core';
import { route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ ctx, params }) => acceptLead(ctx, params.id));
