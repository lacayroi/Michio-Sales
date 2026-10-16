import { updateUser } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { ROLES } from '@/lib/schemas';

const Body = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().max(30).nullish(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['AVAILABLE', 'BUSY', 'OFF', 'INACTIVE']).optional(),
  maxOpenLeads: z.number().int().min(1).max(1000).optional(),
});

export const PATCH = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await updateUser(prisma, actor, params.id, body));
});
