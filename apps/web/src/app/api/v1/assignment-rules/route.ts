import { createRule, listRules } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed, parseJson } from '@/lib/api';
import { RuleBody } from './schema';

export const GET = authed(async (_req, { actor }) => NextResponse.json({ items: await listRules(prisma, actor) }));

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, RuleBody);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await createRule(prisma, actor, body), { status: 201 });
});
