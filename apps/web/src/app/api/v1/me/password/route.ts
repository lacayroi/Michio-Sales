import { changeOwnPassword } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

const Body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  await changeOwnPassword(prisma, actor, body.currentPassword, body.newPassword);
  return NextResponse.json({ ok: true });
});
