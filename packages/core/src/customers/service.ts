// Wholesale customers (SPEC 6.2, 6.5, §8 /customers).
import { assertAuthorized, type AuthUser, scopeFilter } from '@michio/auth';
import type { BusinessModel, Customer, Lifecycle, OrderBand, Prisma } from '@michio/db';
import { foldVietnamese, normalizeVnPhone } from '@michio/shared';
import { recordAudit } from '../audit';
import { type Actor, type Db, TX_OPTIONS } from '../context';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../errors';
import { activityTimeline } from '../leads/service';
import { type PageParams, pageArgs, toPage } from '../pagination';

export interface CustomerFilters {
  q?: string;
  lifecycle?: Lifecycle[];
  ownerId?: string;
  businessModel?: BusinessModel[];
  province?: string;
  tier?: string;
}

export function customerWhere(user: AuthUser, f: CustomerFilters): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [{ ...scopeFilter(user, 'customer'), deletedAt: null }];
  if (f.lifecycle?.length) and.push({ lifecycle: { in: f.lifecycle } });
  if (f.ownerId) and.push({ ownerId: f.ownerId === 'none' ? null : f.ownerId });
  if (f.businessModel?.length) and.push({ businessModel: { in: f.businessModel } });
  if (f.province?.trim()) and.push({ province: { contains: f.province.trim(), mode: 'insensitive' } });
  if (f.tier) and.push({ tier: f.tier });
  const s = f.q?.trim();
  if (s) {
    const or: Prisma.CustomerWhereInput[] = [
      { contactName: { contains: s, mode: 'insensitive' } },
      { shopName: { contains: s, mode: 'insensitive' } },
      { email: { contains: s.toLowerCase() } },
    ];
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 4) or.push({ phone: { contains: normalizeVnPhone(s) ?? digits.replace(/^0/, '') } });
    and.push({ OR: or });
  }
  return { AND: and };
}

export async function listCustomers(db: Db, user: AuthUser, f: CustomerFilters, page: PageParams = {}) {
  const rows = await db.customer.findMany({
    where: customerWhere(user, f),
    include: { owner: { select: { id: true, fullName: true } } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    ...pageArgs(page),
  });
  return toPage(rows, page);
}

export async function getCustomer(db: Db, user: AuthUser, id: string) {
  const c = await db.customer.findFirst({
    where: { id, orgId: user.orgId, deletedAt: null },
    include: {
      owner: { select: { id: true, fullName: true, phone: true } },
      priceList: { select: { id: true, name: true } },
      identities: { include: { channelAccount: { select: { type: true, name: true } } } },
      leads: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, include: { owner: { select: { id: true, fullName: true } } } },
      deals: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, include: { stage: true } },
      quotes: { orderBy: { createdAt: 'desc' }, take: 20 },
      orders: { where: { deletedAt: null }, orderBy: { orderedAt: 'desc' }, take: 20 },
      tasks: { where: { status: 'TODO' }, orderBy: { dueAt: 'asc' } },
    },
  });
  if (!c) throw new NotFoundError('Không tìm thấy khách hàng');
  assertAuthorized(user, 'customer.view', c);
  return c;
}

export async function customerTimeline(db: Db, user: AuthUser, id: string) {
  const c = await db.customer.findFirst({ where: { id, orgId: user.orgId, deletedAt: null }, select: { id: true, ownerId: true, orgId: true } });
  if (!c) throw new NotFoundError('Không tìm thấy khách hàng');
  assertAuthorized(user, 'customer.view', c);
  return activityTimeline(db, { customerId: id });
}

export interface CustomerPatch {
  contactName?: string;
  phone?: string | null;
  email?: string | null;
  shopName?: string | null;
  taxCode?: string | null;
  businessModel?: BusinessModel | null;
  expectedOrderBand?: OrderBand | null;
  interestCategories?: string[];
  province?: string | null;
  address?: string | null;
  facebookUrl?: string | null;
  zaloPhone?: string | null;
  tier?: string | null;
  priceListId?: string | null;
  tags?: string[];
  note?: string | null;
  reorderCycleDays?: number;
}

const AUDITED: (keyof Customer)[] = [
  'contactName', 'phone', 'email', 'shopName', 'taxCode', 'businessModel', 'expectedOrderBand', 'interestCategories',
  'province', 'address', 'facebookUrl', 'zaloPhone', 'tier', 'priceListId', 'tags', 'note', 'reorderCycleDays', 'reorderCycleLocked',
];

function pick(c: Customer, keys: (keyof Customer)[]) {
  return Object.fromEntries(keys.map((k) => [k, c[k] as unknown])) as Prisma.InputJsonObject;
}

async function assertPhoneFree(db: Db, orgId: string, phone: string, exceptId?: string) {
  const other = await db.customer.findFirst({ where: { orgId, deletedAt: null, phone, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, contactName: true } });
  if (other) throw new ConflictError('DUPLICATE_PHONE', `Số điện thoại đã thuộc khách "${other.contactName}" — dùng chức năng Gộp`, { customerId: other.id });
}

export async function updateCustomer(db: Db, actor: Actor, id: string, patch: CustomerPatch) {
  const user = actor.user!;
  const c = await db.customer.findFirst({ where: { id, orgId: actor.orgId, deletedAt: null } });
  if (!c) throw new NotFoundError('Không tìm thấy khách hàng');
  assertAuthorized(user, 'customer.update', c);

  const data: Prisma.CustomerUpdateInput = {};
  const str = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
  if (patch.contactName !== undefined) {
    if (!patch.contactName.trim()) throw new ValidationError('Cần tên người liên hệ');
    data.contactName = patch.contactName.trim();
  }
  if (patch.phone !== undefined) {
    const phone = patch.phone ? normalizeVnPhone(patch.phone) : null;
    if (patch.phone && !phone) throw new ValidationError('Số điện thoại không hợp lệ', { phone: ['Số điện thoại không hợp lệ'] });
    if (phone && phone !== c.phone) await assertPhoneFree(db, actor.orgId, phone, id);
    data.phone = phone;
  }
  if (patch.zaloPhone !== undefined) {
    const z = patch.zaloPhone ? normalizeVnPhone(patch.zaloPhone) : null;
    if (patch.zaloPhone && !z) throw new ValidationError('Số Zalo không hợp lệ', { zaloPhone: ['Số Zalo không hợp lệ'] });
    data.zaloPhone = z;
  }
  if (patch.email !== undefined) data.email = str(patch.email)?.toLowerCase() ?? null;
  for (const k of ['shopName', 'taxCode', 'province', 'address', 'facebookUrl', 'note'] as const) {
    if (patch[k] !== undefined) data[k] = str(patch[k]);
  }
  if (patch.businessModel !== undefined) data.businessModel = patch.businessModel;
  if (patch.expectedOrderBand !== undefined) data.expectedOrderBand = patch.expectedOrderBand;
  if (patch.interestCategories) data.interestCategories = [...new Set(patch.interestCategories)];
  if (patch.tags) data.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))];
  // Tier / price list decide wholesale prices (SPEC 6.5) — Owner/Manager only.
  if (patch.tier !== undefined || patch.priceListId !== undefined) {
    assertAuthorized(user, 'priceList.manage');
    if (patch.tier !== undefined) data.tier = str(patch.tier);
    if (patch.priceListId !== undefined) data.priceList = patch.priceListId ? { connect: { id: patch.priceListId } } : { disconnect: true };
  }
  if (patch.reorderCycleDays !== undefined) {
    if (patch.reorderCycleDays < 7 || patch.reorderCycleDays > 120) throw new ValidationError('Chu kỳ tái đặt từ 7 đến 120 ngày');
    data.reorderCycleDays = patch.reorderCycleDays;
    data.reorderCycleLocked = true; // SPEC 6.8: sửa tay → khóa không tự tính lại
    if (c.lastOrderAt) data.nextReorderAt = new Date(c.lastOrderAt.getTime() + patch.reorderCycleDays * 86_400_000);
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id }, data });
    await recordAudit(tx, {
      orgId: c.orgId,
      actorId: user.id,
      via: actor.via,
      action: 'customer.update',
      entityType: 'Customer',
      entityId: id,
      before: pick(c, AUDITED),
      after: pick(updated, AUDITED),
      ip: actor.ip,
    });
    return updated;
  });
}

/**
 * Merge `sourceId` into `targetId` (SPEC 6.2 "Gộp"): moves every related record, fills blank
 * fields of the target, soft-deletes the source. Both must be visible/editable by the user.
 */
export async function mergeCustomers(db: Db, actor: Actor, targetId: string, sourceId: string) {
  const user = actor.user!;
  if (targetId === sourceId) throw new ValidationError('Hãy chọn hai hồ sơ khác nhau');
  const [target, source] = await Promise.all([
    db.customer.findFirst({ where: { id: targetId, orgId: actor.orgId, deletedAt: null } }),
    db.customer.findFirst({ where: { id: sourceId, orgId: actor.orgId, deletedAt: null } }),
  ]);
  if (!target || !source) throw new NotFoundError('Không tìm thấy khách hàng');
  assertAuthorized(user, 'customer.merge', target);
  assertAuthorized(user, 'customer.merge', source);
  if (target.orderCount > 0 && source.orderCount > 0 && target.ownerId && source.ownerId && target.ownerId !== source.ownerId) {
    throw new DomainError('MERGE_CONFLICT', 'Hai khách đều có đơn với 2 sales khác nhau — cần Owner chuyển giao trước khi gộp', 409);
  }

  return db.$transaction(async (tx) => {
    const blank = <K extends keyof Customer>(k: K) => (target[k] === null || target[k] === undefined ? source[k] : undefined);
    const data: Prisma.CustomerUncheckedUpdateInput = {
      phone: blank('phone'),
      email: blank('email'),
      shopName: blank('shopName'),
      taxCode: blank('taxCode'),
      businessModel: blank('businessModel'),
      expectedOrderBand: blank('expectedOrderBand'),
      province: blank('province'),
      address: blank('address'),
      facebookUrl: blank('facebookUrl'),
      zaloPhone: blank('zaloPhone'),
      avatarUrl: blank('avatarUrl'),
      tier: blank('tier'),
      priceListId: blank('priceListId'),
      ownerId: target.ownerId ?? source.ownerId,
      interestCategories: [...new Set([...target.interestCategories, ...source.interestCategories])],
      tags: [...new Set([...target.tags, ...source.tags])],
      note: [target.note, source.note].filter(Boolean).join('\n') || null,
      orderCount: target.orderCount + source.orderCount,
      totalRevenue: target.totalRevenue.add(source.totalRevenue),
      firstOrderAt: minDate(target.firstOrderAt, source.firstOrderAt),
      lastOrderAt: maxDate(target.lastOrderAt, source.lastOrderAt),
    };
    // Free the source's phone first: two live customers may not share one.
    await tx.customer.update({ where: { id: sourceId }, data: { deletedAt: new Date(), phone: null, email: null } });
    const moved = { customerId: targetId };
    await tx.customerIdentity.updateMany({ where: { customerId: sourceId }, data: moved });
    await tx.lead.updateMany({ where: { customerId: sourceId }, data: moved });
    await tx.conversation.updateMany({ where: { customerId: sourceId }, data: moved });
    await tx.deal.updateMany({ where: { customerId: sourceId }, data: moved });
    await tx.quote.updateMany({ where: { customerId: sourceId }, data: moved });
    await tx.order.updateMany({ where: { customerId: sourceId }, data: moved });
    await tx.task.updateMany({ where: { customerId: sourceId }, data: moved });
    await tx.activity.updateMany({ where: { customerId: sourceId }, data: moved });
    const merged = await tx.customer.update({ where: { id: targetId }, data });
    await tx.activity.create({
      data: { orgId: actor.orgId, customerId: targetId, userId: user.id, type: 'MERGE', data: { fromCustomerId: sourceId, fromName: source.contactName } },
    });
    await recordAudit(tx, {
      orgId: actor.orgId,
      actorId: user.id,
      via: actor.via,
      action: 'customer.merge',
      entityType: 'Customer',
      entityId: targetId,
      before: { target: pick(target, AUDITED), source: { id: sourceId, ...pick(source, AUDITED) } },
      after: pick(merged, AUDITED),
      ip: actor.ip,
    });
    return merged;
  }, TX_OPTIONS);
}

const minDate = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));
const maxDate = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** "Gợi ý gộp khi tên + tỉnh trùng" (SPEC 6.2), accent-insensitive. */
export async function mergeSuggestions(db: Db, user: AuthUser, id: string) {
  const c = await db.customer.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
  if (!c) throw new NotFoundError('Không tìm thấy khách hàng');
  assertAuthorized(user, 'customer.view', c);
  if (!c.province) return [];
  const name = foldVietnamese(c.contactName);
  const province = foldVietnamese(c.province);
  const sameName = await db.customer.findMany({
    where: { AND: [customerWhere(user, {}), { id: { not: id } }, { province: { not: null } }] },
    select: { id: true, contactName: true, shopName: true, phone: true, province: true, ownerId: true },
    take: 2000,
  });
  return sameName.filter((o) => foldVietnamese(o.contactName) === name && foldVietnamese(o.province!) === province).slice(0, 10);
}
