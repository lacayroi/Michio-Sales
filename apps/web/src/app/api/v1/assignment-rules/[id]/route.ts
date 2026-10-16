import { deleteRule, updateRule } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed, parseJson } from '@/lib/api';
import { RuleBody } from '../schema';

export const PATCH = authed<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, RuleBody.partial());
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await updateRule(prisma, actor, params.id, body));
});

export const DELETE = authed<{ id: string }>(async (_req, { actor, params }) => {
  await deleteRule(prisma, actor, params.id);
  return new NextResponse(null, { status: 204 });
});
