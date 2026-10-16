import { createApiKey, listApiKeys } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

export const GET = authed(async (_req, { actor }) => NextResponse.json({ items: await listApiKeys(prisma, actor) }));

const Body = z.object({
  name: z.string().trim().min(1).max(100),
  source: z.enum(['WEBSITE_WHOLESALE_FORM', 'WEBSITE_AGENT_FORM', 'OTHER']).default('WEBSITE_WHOLESALE_FORM'),
});

/** The plaintext key is returned once — only its hash is stored. */
export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await createApiKey(prisma, actor, body), { status: 201 });
});
