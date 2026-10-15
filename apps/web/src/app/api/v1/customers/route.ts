import { assertAuthorized } from '@michio/auth';
import { listCustomers, recordAudit } from '@michio/core';
import { normalizeVnPhone } from '@michio/shared';
import { z } from 'zod';
import { HttpError, readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listCustomers(ctx, searchParamsOf(req)));

// Creates a customer record without opening a lead (e.g. a known shop added by hand).
const Body = z.object({
  contactName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(30),
  shopName: z.string().trim().max(200).optional(),
  province: z.string().trim().max(80).optional(),
});

export const POST = route(async ({ req, ctx, user }) => {
  assertAuthorized(user, 'customer.create');
  const b = await readJson(req, Body);
  const phone = normalizeVnPhone(b.phone);
  if (!phone) throw new HttpError(422, 'VALIDATION_ERROR', 'Số điện thoại không hợp lệ');
  const dup = await ctx.db.customer.findFirst({ where: { orgId: ctx.orgId, phone, deletedAt: null } });
  if (dup) throw new HttpError(409, 'CONFLICT', `SĐT đã thuộc khách "${dup.contactName}"`, { customerId: dup.id });
  return ctx.db.$transaction(async (tx) => {
    const c = await tx.customer.create({
      data: { orgId: ctx.orgId, contactName: b.contactName, phone, shopName: b.shopName, province: b.province, ownerId: user.role === 'SALES' ? user.id : null },
    });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: user.id, via: 'WEB', action: 'customer.create', entityType: 'Customer', entityId: c.id, after: { contactName: c.contactName, phone }, ip: ctx.ip });
    return c;
  });
}, { status: 201 });
