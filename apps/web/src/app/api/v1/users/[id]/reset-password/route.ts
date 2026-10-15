import { resetUserPassword } from '@michio/core';
import { NextResponse } from 'next/server';
import { route } from '@/lib/api';

// SPEC 6.1: temporary password shown once to Owner/Manager; the user must change it at next login.
export const POST = route<{ id: string }>(async ({ ctx, params }) => {
  const out = await resetUserPassword(ctx, params.id);
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
});
