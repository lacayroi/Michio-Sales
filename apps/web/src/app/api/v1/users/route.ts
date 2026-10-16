import { createUser, listUsers } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { ROLES } from '@/lib/schemas';

export const GET = authed(async (_req, { actor }) => NextResponse.json({ items: await listUsers(prisma, actor) }));

const Body = z.object({
  email: z.email().max(200),
  phone: z.string().trim().max(30).nullish(),
  fullName: z.string().trim().min(1).max(200),
  role: z.enum(ROLES),
  maxOpenLeads: z.number().int().min(1).max(1000).optional(),
});

/** Returns the temporary password once (shown to the Owner to hand over). */
export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await createUser(prisma, actor, body), { status: 201 });
});
