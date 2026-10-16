import { reorderRules } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

const Body = z.object({ ids: z.array(z.string()).min(1).max(100) });

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  await reorderRules(prisma, actor, body.ids);
  return NextResponse.json({ ok: true });
});
