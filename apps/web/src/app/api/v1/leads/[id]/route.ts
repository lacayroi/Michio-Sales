import { getLeadDetail, LeadUpdateInput, softDeleteLead, updateLead } from '@michio/core';
import { readJson, route } from '@/lib/api';

type P = { id: string };
export const GET = route<P>(async ({ ctx, params }) => getLeadDetail(ctx, params.id));
export const PATCH = route<P>(async ({ req, ctx, params }) => updateLead(ctx, params.id, await readJson(req, LeadUpdateInput)));
export const DELETE = route<P>(async ({ ctx, params }) => {
  await softDeleteLead(ctx, params.id);
  return { ok: true };
});
