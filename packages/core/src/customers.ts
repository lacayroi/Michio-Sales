// Wholesale customer profile, merge and lifecycle (SPEC 6.2, 6.5).
import { assertAuthorized } from '@michio/auth';
import type { Lifecycle, Prisma } from '@michio/db';
import { normalizeVnPhone } from '@michio/shared';
import { z } from 'zod';
import { recordAudit } from './audit';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';

const DAY = 86_400_000;

/** Lifecycle rules (SPEC 6.5). Pure so import, jobs and tests share one definition. */
export function computeLifecycle(
  c: { orderCount: number; lastOrderAt: Date | null; reorderCycleDays: number },
  now: Date,
  dormantDays = 90,
): Lifecycle {
  if (c.orderCount <= 0 || !c.lastOrderAt) return 'PROSPECT';
  const since = (now.getTime() - c.lastOrderAt.getTime()) / DAY;
  if (since > dormantDays) return 'DORMANT';
  if (since > 1.5 * c.reorderCycleDays) return 'AT_RISK';
  return c.orderCount >= 2 ? 'REPEAT' : 'NEW_CUSTOMER';
}

const text = (max: number) => z.string().trim().max(max).nullable().optional();

export const CustomerUpdateInput = z.object({
  contactName: z.string().trim().min(1).max(120).optional(),
  phone: text(30),
  email: z.union([z.email(), z.literal(''), z.null()]).optional(),
  shopName: text(200),
  taxCode: text(20),
  businessModel: z.enum(['JAPAN_STORE', 'ONLINE_SHOP', 'MINIMART', 'RETAIL_AGENT', 'CAFE', 'DISTRIBUTOR', 'OTHER']).nullable().optional(),
  expectedOrderBand: z.enum(['LT_5M', 'B5_10M', 'B10_30M', 'B30_50M', 'GT_50M', 'UNKNOWN']).nullable().optional(),
  interestCategories: z.array(z.string().max(60)).max(30).optional(),
  province: text(80),
  address: text(300),
  facebookUrl: text(300),
  zaloPhone: text(30),
  tags: z.array(z.string().max(40)).max(20).optional(),
  note: text(4000),
  /** Owner/Manager only (priceList.manage): tier decides the price list (6.5). */
  tier: z.string().trim().max(30).nullable().optional(),
  priceListId: z.string().nullable().optional(),
  /** Manual cycle locks it against automatic recalculation (6.8); null unlocks. */
  reorderCycleDays: z.coerce.number().int().min(7).max(365).nullable().optional(),
});

const AUDITED_FIELDS = [...Object.keys(CustomerUpdateInput.shape), 'reorderCycleLocked', 'nextReorderAt'] as (keyof z.infer<typeof CustomerUpdateInput> | 'reorderCycleLocked' | 'nextReorderAt')[];

export async function updateCustomer(ctx: ServiceContext, customerId: string, raw: z.input<typeof CustomerUpdateInput>) {
  const input = CustomerUpdateInput.parse(raw);
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const { tier, priceListId, reorderCycleDays, ...rest } = input;
  const data: Prisma.CustomerUpdateInput = { ...rest };
  if (input.phone !== undefined) {
    const phone = input.phone ? normalizeVnPhone(input.phone) : null;
    if (input.phone && !phone) throw new DomainError('VALIDATION_ERROR', 'Số điện thoại không hợp lệ', { phone: ['Số điện thoại không hợp lệ'] });
    data.phone = phone;
  }
  if (input.email === '') data.email = null;

  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, orgId: ctx.orgId, deletedAt: null } });
    if (!c) throw notFound('khách hàng');
    assertAuthorized(actor, 'customer.update', c);
    if (tier !== undefined || priceListId !== undefined) {
      assertAuthorized(actor, 'priceList.manage');
      if (tier !== undefined) data.tier = tier || null;
      if (priceListId) {
        const pl = await tx.priceList.findFirst({ where: { id: priceListId, orgId: ctx.orgId } });
        if (!pl) throw notFound('bảng giá');
        data.priceList = { connect: { id: pl.id } };
        if (tier === undefined) data.tier = pl.tier;
      } else if (priceListId === null) data.priceList = { disconnect: true };
    }
    if (reorderCycleDays !== undefined) {
      const cycle = reorderCycleDays ?? c.reorderCycleDays;
      data.reorderCycleDays = cycle;
      data.reorderCycleLocked = reorderCycleDays !== null;
      data.nextReorderAt = c.lastOrderAt ? new Date(c.lastOrderAt.getTime() + cycle * DAY) : null;
    }
    if (data.phone) {
      const clash = await tx.customer.findFirst({ where: { orgId: ctx.orgId, phone: data.phone as string, deletedAt: null, id: { not: c.id } } });
      if (clash) throw new DomainError('CONFLICT', `SĐT đã thuộc khách "${clash.contactName}" — hãy dùng chức năng Gộp`, { customerId: clash.id });
    }
    const updated = await tx.customer.update({ where: { id: c.id }, data });
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const f of AUDITED_FIELDS) {
      if (JSON.stringify(c[f]) !== JSON.stringify(updated[f])) {
        before[f] = c[f];
        after[f] = updated[f];
      }
    }
    if (Object.keys(after).length) {
      await recordAudit(tx, {
        orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'customer.update', entityType: 'Customer', entityId: c.id,
        before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue, ip: ctx.ip,
      });
    }
    outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: c.ownerId ? [c.ownerId] : [], roles: MANAGERS }, data: { customerId: c.id } });
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}

/** "Gợi ý gộp" (SPEC 6.2): same contact name + province, or same phone/email on another record. */
export async function suggestMerges(ctx: ServiceContext, customerId: string) {
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, orgId: ctx.orgId, deletedAt: null } });
  if (!c) throw notFound('khách hàng');
  const or: Prisma.CustomerWhereInput[] = [];
  if (c.province) or.push({ contactName: { equals: c.contactName, mode: 'insensitive' }, province: { equals: c.province, mode: 'insensitive' } });
  if (c.phone) or.push({ phone: c.phone });
  if (c.email) or.push({ email: { equals: c.email, mode: 'insensitive' } });
  if (!or.length) return [];
  return ctx.db.customer.findMany({
    where: { orgId: ctx.orgId, deletedAt: null, id: { not: c.id }, OR: or },
    select: { id: true, contactName: true, phone: true, shopName: true, province: true, ownerId: true, createdAt: true },
    take: 10,
  });
}

/**
 * "Gộp" (SPEC 6.2): moves everything from `sourceId` into `targetId`, fills empty fields,
 * sums order stats and soft-deletes the source. Both records must be editable by the actor.
 */
export async function mergeCustomers(ctx: ServiceContext, targetId: string, sourceId: string) {
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  if (targetId === sourceId) throw new DomainError('VALIDATION_ERROR', 'Không thể gộp một khách với chính nó');
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const [target, source] = await Promise.all([
      tx.customer.findFirst({ where: { id: targetId, orgId: ctx.orgId, deletedAt: null } }),
      tx.customer.findFirst({ where: { id: sourceId, orgId: ctx.orgId, deletedAt: null } }),
    ]);
    if (!target || !source) throw notFound('khách hàng');
    assertAuthorized(actor, 'customer.merge', target);
    assertAuthorized(actor, 'customer.merge', source);

    const move = { where: { customerId: source.id }, data: { customerId: target.id } };
    await Promise.all([
      tx.lead.updateMany(move),
      tx.conversation.updateMany(move),
      tx.deal.updateMany(move),
      tx.quote.updateMany(move),
      tx.order.updateMany(move),
      tx.task.updateMany(move),
      tx.activity.updateMany(move),
      tx.customerIdentity.updateMany(move),
    ]);
    const fill = <T>(a: T | null, b: T | null) => (a === null || a === '' ? b : a);
    const firstOrderAt = [target.firstOrderAt, source.firstOrderAt].filter(Boolean).sort((a, b) => +a! - +b!)[0] ?? null;
    const lastOrderAt = [target.lastOrderAt, source.lastOrderAt].filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null;
    const orderCount = target.orderCount + source.orderCount;
    const { reorderCycleDays } = target;
    const updated = await tx.customer.update({
      where: { id: target.id },
      data: {
        phone: fill(target.phone, source.phone),
        email: fill(target.email, source.email),
        shopName: fill(target.shopName, source.shopName),
        taxCode: fill(target.taxCode, source.taxCode),
        businessModel: fill(target.businessModel, source.businessModel),
        expectedOrderBand: fill(target.expectedOrderBand, source.expectedOrderBand),
        province: fill(target.province, source.province),
        address: fill(target.address, source.address),
        facebookUrl: fill(target.facebookUrl, source.facebookUrl),
        zaloPhone: fill(target.zaloPhone, source.zaloPhone),
        avatarUrl: fill(target.avatarUrl, source.avatarUrl),
        ownerId: target.ownerId ?? source.ownerId,
        tier: fill(target.tier, source.tier),
        priceListId: fill(target.priceListId, source.priceListId),
        interestCategories: [...new Set([...target.interestCategories, ...source.interestCategories])],
        tags: [...new Set([...target.tags, ...source.tags])],
        note: [target.note, source.note].filter(Boolean).join('\n---\n') || null,
        orderCount,
        totalRevenue: target.totalRevenue.add(source.totalRevenue),
        firstOrderAt,
        lastOrderAt,
        nextReorderAt: lastOrderAt ? new Date(lastOrderAt.getTime() + reorderCycleDays * DAY) : null,
        lifecycle: computeLifecycle({ orderCount, lastOrderAt, reorderCycleDays }, ctx.now()),
      },
    });
    await tx.customer.update({ where: { id: source.id }, data: { deletedAt: ctx.now(), note: `[Đã gộp vào ${target.id}] ${source.note ?? ''}`.trim() } });
    await tx.activity.create({
      data: { orgId: ctx.orgId, customerId: target.id, userId: actor.id, type: 'MERGE', data: { fromCustomerId: source.id, fromName: source.contactName, fromPhone: source.phone }, createdAt: ctx.now() },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'customer.merge', entityType: 'Customer', entityId: target.id,
      before: { target: { id: target.id, phone: target.phone }, source: { id: source.id, phone: source.phone, contactName: source.contactName } },
      after: { phone: updated.phone, orderCount: updated.orderCount }, ip: ctx.ip,
    });
    outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: updated.ownerId ? [updated.ownerId] : [], roles: MANAGERS }, data: { customerId: target.id } });
    return updated;
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}
