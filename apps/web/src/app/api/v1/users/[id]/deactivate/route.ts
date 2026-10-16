import { deactivateUser } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';

/** INACTIVE takes effect on the user's next request (sessions re-load the user). Hand-over of leads: M5. */
export const POST = authed<{ id: string }>(async (_req, { actor, params }) => NextResponse.json(await deactivateUser(prisma, actor, params.id)));
