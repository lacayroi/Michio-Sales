import { intakeLead, LeadIntakeInput, listLeads } from '@michio/core';
import { readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listLeads(ctx, searchParamsOf(req)));

export const POST = route(async ({ req, ctx, user }) => {
  const body = await readJson(req, LeadIntakeInput);
  // SALES default to keeping leads they create (SPEC §3); Owner/Manager default to the rotation.
  const assignMode = body.assignMode ?? (user.role === 'SALES' && body.source !== 'ZALO_COMPANY' ? 'SELF' : 'AUTO');
  return intakeLead(ctx, { ...body, assignMode });
}, { status: 201 });
