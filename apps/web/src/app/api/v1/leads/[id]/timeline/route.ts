import { leadTimeline } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';

export const GET = authed<{ id: string }>(async (_req, { user, params }) =>
  NextResponse.json({ items: await leadTimeline(prisma, user, params.id) }),
);
