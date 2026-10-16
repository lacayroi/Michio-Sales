import { confirmHolidayYear } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

/** Owner xác nhận lịch nghỉ lễ của năm (SPEC 6.1). */
const Body = z.object({ year: z.number().int().min(2000).max(2100) });

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json({ confirmedYears: await confirmHolidayYear(prisma, actor, body.year) });
});
