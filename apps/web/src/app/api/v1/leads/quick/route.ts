import { intakeLead } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed, parseJson } from '@/lib/api';
import { getEffects } from '@/lib/effects';
import { QuickLeadBody } from '@/lib/schemas';

/** "+ Lead nhanh" (SPEC 5.3 chế độ A): SĐT + tên + ghi chú, < 15 giây. */
export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, QuickLeadBody);
  if (body instanceof NextResponse) return body;
  const r = await intakeLead(
    prisma,
    getEffects(),
    actor,
    { source: body.source, contactName: body.name, phone: body.phone, need: body.note },
    body.assign ? { mode: body.assign } : undefined,
  );
  return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
});
