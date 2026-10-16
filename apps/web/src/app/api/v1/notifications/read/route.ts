import { markNotificationsRead } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

/** {ids} marks those; empty body / no ids marks everything read. */
const Body = z.object({ ids: z.array(z.string()).max(200).optional() });

export const POST = authed(async (req, { user }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  await markNotificationsRead(prisma, user.id, body.ids);
  return NextResponse.json({ ok: true });
});
