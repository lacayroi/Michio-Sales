import { assignLeads } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { getEffects } from '@/lib/effects';

const Body = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
  userId: z.string().optional(),
  auto: z.literal(true).optional(),
});

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  const target = body.userId ? { userId: body.userId } : { auto: true as const };
  const results = await assignLeads(prisma, getEffects(), actor, body.leadIds, target);
  return NextResponse.json({ results, ok: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length });
});
