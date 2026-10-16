import { removeHoliday } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';

export const DELETE = authed<{ id: string }>(async (_req, { actor, params }) => {
  await removeHoliday(prisma, actor, params.id);
  return new NextResponse(null, { status: 204 });
});
