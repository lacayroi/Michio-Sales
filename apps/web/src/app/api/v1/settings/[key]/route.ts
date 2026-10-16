import { getSetting, putSetting } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

export const GET = authed<{ key: string }>(async (_req, { actor, params }) =>
  NextResponse.json({ key: params.key, value: await getSetting(prisma, actor, params.key) }),
);

const Body = z.object({ value: z.unknown() });

export const PUT = authed<{ key: string }>(async (req, { actor, params }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json({ key: params.key, value: await putSetting(prisma, actor, params.key, body.value) });
});
