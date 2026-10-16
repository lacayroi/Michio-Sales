import { removeLeave } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';

export const DELETE = authed<{ id: string; leaveId: string }>(async (_req, { actor, params }) => {
  await removeLeave(prisma, actor, params.id, params.leaveId);
  return new NextResponse(null, { status: 204 });
});
