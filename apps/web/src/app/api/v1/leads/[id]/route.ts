import { deleteLead, getLead, updateLead } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { getEffects } from '@/lib/effects';
import { PRIORITIES } from '@/lib/schemas';

export const GET = authed<{ id: string }>(async (_req, { user, params }) => NextResponse.json(await getLead(prisma, user, params.id)));

const Patch = z.object({
  need: z.string().max(2000).nullish(),
  priority: z.enum(PRIORITIES).optional(),
  campaign: z.string().max(200).nullish(),
  status: z.literal('LOST').optional(),
  lostReasonId: z.string().optional(),
  lostNote: z.string().max(2000).nullish(),
});

export const PATCH = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await updateLead(prisma, getEffects(), actor, params.id, body));
});

export const DELETE = authed<{ id: string }>(async (_req, { actor, params }) => {
  await deleteLead(prisma, actor, params.id);
  return new NextResponse(null, { status: 204 });
});
