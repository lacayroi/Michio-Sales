import { intakeLead } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

// "+ Lead nhanh" (SPEC 5.3 chế độ A): phone + name + note, < 15 s for the person on duty.
const Body = z.object({
  phone: z.string().trim().min(6, 'Nhập số điện thoại').max(30),
  name: z.string().trim().min(1, 'Nhập tên khách').max(120),
  note: z.string().trim().max(2000).optional(),
  source: z.enum(['ZALO_COMPANY', 'HOTLINE', 'REFERRAL', 'MANUAL', 'OTHER']).default('ZALO_COMPANY'),
  /** SALES: keep it or send to rotation. Default: Zalo công ty → rotation, others → self. */
  assignMode: z.enum(['AUTO', 'SELF']).optional(),
});

export const POST = route(async ({ req, ctx, user }) => {
  const b = await readJson(req, Body);
  const assignMode = b.assignMode ?? (user.role === 'SALES' && b.source !== 'ZALO_COMPANY' ? 'SELF' : 'AUTO');
  return intakeLead(ctx, { source: b.source, fullName: b.name, phone: b.phone, need: b.note, assignMode });
}, { status: 201 });
