import { acceptLead } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';
import { getEffects } from '@/lib/effects';

export const POST = authed<{ id: string }>(async (_req, { actor, params }) =>
  NextResponse.json(await acceptLead(prisma, getEffects(), actor, params.id)),
);
