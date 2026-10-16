import { addLeadActivity } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { getEffects } from '@/lib/effects';

const Body = z.object({
  type: z.enum(['CALL', 'NOTE', 'MEETING']),
  result: z.enum(['ANSWERED', 'NO_ANSWER', 'CALL_BACK']).optional(),
  note: z.string().max(5000).nullish(),
});

export const POST = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await addLeadActivity(prisma, getEffects(), actor, params.id, body), { status: 201 });
});
