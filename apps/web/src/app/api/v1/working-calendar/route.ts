import { assertAuthorized } from '@michio/auth';
import { getWorkingCalendar, setWorkingCalendar, WeeklySchema } from '@michio/core';
import { prisma } from '@michio/db';
import type { WeeklyHours } from '@michio/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

export const GET = authed(async (_req, { user }) => {
  assertAuthorized(user, 'settings.manage');
  return NextResponse.json({ weekly: await getWorkingCalendar(prisma, user.orgId) });
});

const Body = z.object({ weekly: WeeklySchema });

export const PUT = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  await setWorkingCalendar(prisma, actor, body.weekly as WeeklyHours[]);
  return NextResponse.json({ ok: true });
});
