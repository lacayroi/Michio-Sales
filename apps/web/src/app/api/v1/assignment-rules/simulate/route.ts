import { simulateAssignment } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';
import { BUSINESS_MODELS, LEAD_SOURCES, ORDER_BANDS, PRIORITIES } from '@/lib/schemas';

/** "Thử luật" (SPEC 6.12): nhập lead giả để xem ai nhận — không thay đổi dữ liệu. */
const Body = z.object({
  source: z.enum(LEAD_SOURCES),
  phone: z.string().max(30).nullish(),
  priority: z.enum(PRIORITIES).optional(),
  businessModel: z.enum(BUSINESS_MODELS).nullish(),
  expectedOrderBand: z.enum(ORDER_BANDS).nullish(),
  interestCategories: z.array(z.string()).max(30).optional(),
  province: z.string().max(100).nullish(),
  tags: z.array(z.string()).max(20).optional(),
  at: z.coerce.date().optional(),
});

export const POST = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await simulateAssignment(prisma, actor, body));
});
