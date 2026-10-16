import { addLeadActivity, LeadActivityInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => addLeadActivity(ctx, params.id, await readJson(req, LeadActivityInput)), { status: 201 });
