import { intakeLead, type IntakeAssign, listLeads } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed, parseJson, parseQuery } from '@/lib/api';
import { getEffects } from '@/lib/effects';
import { LeadCreateBody, LeadListQuery, toLeadInput } from '@/lib/schemas';

export const GET = authed(async (req, { user }) => {
  const q = parseQuery(req, LeadListQuery);
  if (q instanceof NextResponse) return q;
  const { cursor, limit, ...filters } = q;
  return NextResponse.json(await listLeads(prisma, user, filters, { cursor, limit }));
});

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, LeadCreateBody);
  if (body instanceof NextResponse) return body;
  const assign: IntakeAssign | undefined =
    body.assign === 'user' && body.assigneeId ? { mode: 'user', userId: body.assigneeId } : body.assign === 'auto' ? { mode: 'auto' } : body.assign === 'self' ? { mode: 'self' } : undefined;
  const r = await intakeLead(prisma, getEffects(), actor, toLeadInput(body), assign);
  return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
});
