import { intakeLead, listCustomers } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed, parseJson, parseQuery } from '@/lib/api';
import { getEffects } from '@/lib/effects';
import { CustomerListQuery, LeadCreateBody, toLeadInput } from '@/lib/schemas';

export const GET = authed(async (req, { user }) => {
  const q = parseQuery(req, CustomerListQuery);
  if (q instanceof NextResponse) return q;
  const { cursor, limit, ...filters } = q;
  return NextResponse.json(await listCustomers(prisma, user, filters, { cursor, limit }));
});

/**
 * A new customer always enters as a lead (SPEC 6.2: one intake path with de-duplication);
 * the response carries both ids.
 */
export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, LeadCreateBody.partial({ source: true }));
  if (body instanceof NextResponse) return body;
  const r = await intakeLead(prisma, getEffects(), actor, toLeadInput({ ...body, source: body.source ?? 'MANUAL' }));
  return NextResponse.json(r, { status: r.existingCustomer ? 200 : 201 });
});
