import { customerTimeline } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';

export const GET = authed<{ id: string }>(async (_req, { user, params }) =>
  NextResponse.json({ items: await customerTimeline(prisma, user, params.id) }),
);
