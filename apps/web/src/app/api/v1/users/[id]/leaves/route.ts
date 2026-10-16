import { addLeave } from '@michio/core';
import { assertAuthorized } from '@michio/auth';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

export const GET = authed<{ id: string }>(async (_req, { user, params }) => {
  assertAuthorized(user, 'user.view');
  const items = await prisma.userLeave.findMany({ where: { userId: params.id, user: { orgId: user.orgId } }, orderBy: { startAt: 'desc' } });
  return NextResponse.json({ items });
});

const Body = z.object({ startAt: z.coerce.date(), endAt: z.coerce.date(), reason: z.string().max(500).nullish() });

export const POST = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await addLeave(prisma, actor, params.id, body), { status: 201 });
});
