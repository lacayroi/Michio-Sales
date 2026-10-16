import { mergeSuggestions } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';

/** "Gợi ý gộp khi tên + tỉnh trùng" (SPEC 6.2). */
export const GET = authed<{ id: string }>(async (_req, { user, params }) =>
  NextResponse.json({ items: await mergeSuggestions(prisma, user, params.id) }),
);
