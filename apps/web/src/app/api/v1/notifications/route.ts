import { listNotifications } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseQuery, zBool } from '@/lib/api';

export const GET = authed(async (req, { user }) => {
  const q = parseQuery(req, z.object({ unread: zBool.optional(), limit: z.coerce.number().int().min(1).max(100).optional() }));
  if (q instanceof NextResponse) return q;
  return NextResponse.json(await listNotifications(prisma, user.id, { unreadOnly: q.unread, limit: q.limit }));
});
