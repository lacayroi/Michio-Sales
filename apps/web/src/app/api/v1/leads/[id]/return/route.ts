import { returnLead } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { getEffects } from '@/lib/effects';

const Body = z.object({ reason: z.string().trim().max(500).nullish() });

export const POST = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await returnLead(prisma, getEffects(), actor, params.id, body.reason));
});
