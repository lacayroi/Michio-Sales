import { assignLeads } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { getEffects } from '@/lib/effects';

/** {userId} giao/chuyển cho 1 người · {auto:true} chạy lại luật chia (SPEC 6.3.5). */
const AssignTarget = z.union([z.object({ userId: z.string().min(1) }), z.object({ auto: z.literal(true) })]);

export const POST = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, AssignTarget);
  if (body instanceof NextResponse) return body;
  const [result] = await assignLeads(prisma, getEffects(), actor, [params.id], body);
  return NextResponse.json(result);
});
