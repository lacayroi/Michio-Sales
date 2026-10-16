import { assertAuthorized } from '@michio/auth';
import { addHoliday, listHolidays } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson, parseQuery } from '@/lib/api';

export const GET = authed(async (req, { user }) => {
  assertAuthorized(user, 'settings.manage');
  const q = parseQuery(req, z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }));
  if (q instanceof NextResponse) return q;
  return NextResponse.json({ items: await listHolidays(prisma, user.orgId, q.year) });
});

const Body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1).max(100) });

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await addHoliday(prisma, actor, body), { status: 201 });
});
