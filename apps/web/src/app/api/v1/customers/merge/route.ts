import { mergeCustomers } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

const Body = z.object({ targetId: z.string().min(1), sourceId: z.string().min(1) });

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await mergeCustomers(prisma, actor, body.targetId, body.sourceId));
});
