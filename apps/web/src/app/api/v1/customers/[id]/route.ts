import { getCustomer, updateCustomer } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed, parseJson } from '@/lib/api';
import { CustomerPatchBody } from '@/lib/schemas';

export const GET = authed<{ id: string }>(async (_req, { user, params }) => NextResponse.json(await getCustomer(prisma, user, params.id)));

export const PATCH = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, CustomerPatchBody);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await updateCustomer(prisma, actor, params.id, { ...body, email: body.email === '' ? null : body.email }));
});
