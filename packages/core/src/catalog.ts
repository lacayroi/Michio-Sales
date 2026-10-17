// Sản phẩm & bảng giá sỉ (S13, SPEC 5.6, 6.6): Woo sync, wholesale fields, price lists with Excel.
import { assertAuthorized } from '@michio/auth';
import type { Prisma, PrismaClient } from '@michio/db';
import { createWooHttpClient, createWooMockClient, mapWooProduct, type WooClient, WOOCOMMERCE } from '@michio/integrations';
import { isMockIntegrations } from './runtime';
import { z } from 'zod';
import { recordAudit } from './audit';
import type { ServiceContext } from './context';
import { decryptJson, encryptJson } from './crypto';
import { DomainError, notFound } from './errors';
import { cellText, parseNumber } from './import';
import { managerIds, notifyUsers } from './notifications';
import { Outbox } from './context';
import { parseQtyBreaks, type QtyBreak } from './pricing';

type Tx = Prisma.TransactionClient;

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

// ---------- product wholesale fields (Owner, §8 PATCH /products/:id) ----------

export const ProductPatch = z.object({
  sku: z.string().trim().min(1).max(60).optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  unitsPerCase: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  showInQuote: z.boolean().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
});

export async function updateProduct(ctx: ServiceContext, productId: string, raw: z.input<typeof ProductPatch>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'product.update');
  const input = ProductPatch.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const p = await tx.product.findFirst({ where: { id: productId, orgId: ctx.orgId } });
    if (!p) throw notFound('sản phẩm');
    if (input.sku && input.sku !== p.sku && (await tx.product.findFirst({ where: { orgId: ctx.orgId, sku: input.sku } }))) throw new DomainError('CONFLICT', `Mã ${input.sku} đã tồn tại`);
    const updated = await tx.product.update({ where: { id: p.id }, data: { ...input, ...(input.sku ? { needsSku: false } : {}) } });
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of Object.keys(input) as (keyof typeof input)[]) {
      if (JSON.stringify(p[k]) !== JSON.stringify(updated[k])) {
        before[k] = p[k];
        after[k] = updated[k];
      }
    }
    if (Object.keys(after).length) await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'product.update', entityType: 'Product', entityId: p.id, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue, ip: ctx.ip });
    return updated;
  });
}

// ---------- price lists (Owner/Manager) ----------

export const PriceListInput = z.object({
  name: z.string().trim().min(1, 'Cần tên bảng giá').max(80),
  tier: z.string().trim().min(1).max(30).regex(/^[A-Z0-9_]+$/, 'Mã cấp: chữ in hoa, số, _ (vd SI_1, DAI_LY)'),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
});

export async function listPriceLists(ctx: ServiceContext) {
  actorOf(ctx);
  const lists = await ctx.db.priceList.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: 'asc' }, include: { _count: { select: { items: true, customers: true } } } });
  return lists;
}

export async function savePriceList(ctx: ServiceContext, id: string | null, raw: z.input<typeof PriceListInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'priceList.manage');
  const input = PriceListInput.parse(raw);
  if (input.validFrom && input.validTo && input.validFrom > input.validTo) throw new DomainError('VALIDATION_ERROR', 'Ngày hết hiệu lực phải sau ngày bắt đầu');
  return ctx.db.$transaction(async (tx) => {
    const before = id ? await tx.priceList.findFirst({ where: { id, orgId: ctx.orgId } }) : null;
    if (id && !before) throw notFound('bảng giá');
    const row = id ? await tx.priceList.update({ where: { id }, data: input }) : await tx.priceList.create({ data: { orgId: ctx.orgId, ...input } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: id ? 'priceList.update' : 'priceList.create', entityType: 'PriceList', entityId: row.id, before: before ? { name: before.name, tier: before.tier } : undefined, after: { name: row.name, tier: row.tier }, ip: ctx.ip });
    return row;
  });
}

export const PriceItemInput = z.object({
  productId: z.string(),
  price: z.coerce.number().int().min(0),
  minQty: z.coerce.number().int().min(1).default(1),
  qtyBreaks: z.array(z.object({ minQty: z.coerce.number().int().min(2), price: z.coerce.number().int().min(0) })).max(10).nullable().optional(),
});

export async function getPriceListItems(ctx: ServiceContext, priceListId: string, opts: { q?: string } = {}) {
  actorOf(ctx);
  const list = await ctx.db.priceList.findFirst({ where: { id: priceListId, orgId: ctx.orgId } });
  if (!list) throw notFound('bảng giá');
  const items = await ctx.db.priceListItem.findMany({
    where: { priceListId, ...(opts.q ? { product: { OR: [{ name: { contains: opts.q, mode: 'insensitive' } }, { sku: { contains: opts.q, mode: 'insensitive' } }] } } : {}) },
    include: { product: { select: { id: true, sku: true, name: true, unit: true, unitsPerCase: true, retailPrice: true, inStock: true } } },
    orderBy: { product: { name: 'asc' } },
  });
  return { list, items };
}

/** Upsert lines; `price = null` removes a product from the list. Audited as one change per call. */
export async function upsertPriceListItems(ctx: ServiceContext, priceListId: string, rows: (z.input<typeof PriceItemInput> | { productId: string; remove: true })[]) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'priceList.manage');
  return ctx.db.$transaction(async (tx) => {
    const list = await tx.priceList.findFirst({ where: { id: priceListId, orgId: ctx.orgId } });
    if (!list) throw notFound('bảng giá');
    let upserted = 0;
    let removed = 0;
    for (const raw of rows) {
      if ('remove' in raw) {
        removed += (await tx.priceListItem.deleteMany({ where: { priceListId, productId: raw.productId } })).count;
        continue;
      }
      const r = PriceItemInput.parse(raw);
      const breaks = normalizeBreaks(r.qtyBreaks ?? null, r.price);
      await tx.priceListItem.upsert({
        where: { priceListId_productId: { priceListId, productId: r.productId } },
        create: { priceListId, productId: r.productId, price: r.price, minQty: r.minQty, qtyBreaks: breaks ?? undefined },
        update: { price: r.price, minQty: r.minQty, qtyBreaks: breaks ?? (null as unknown as Prisma.InputJsonValue) },
      });
      upserted++;
    }
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'priceList.items', entityType: 'PriceList', entityId: priceListId, after: { upserted, removed }, ip: ctx.ip });
    return { upserted, removed };
  });
}

function normalizeBreaks(breaks: QtyBreak[] | null, base: number): Prisma.InputJsonValue | null {
  if (!breaks?.length) return null;
  const sorted = [...breaks].sort((a, b) => a.minQty - b.minQty);
  if (new Set(sorted.map((b) => b.minQty)).size !== sorted.length) throw new DomainError('VALIDATION_ERROR', 'Bậc số lượng bị trùng');
  if (sorted.some((b) => b.price > base)) throw new DomainError('VALIDATION_ERROR', 'Giá theo bậc số lượng không được cao hơn giá sỉ');
  return sorted as unknown as Prisma.InputJsonValue;
}

/** "24:95000; 48:90000" ↔ [{minQty, price}] — how quantity breaks are written in Excel. */
export function parseBreaksText(s: string): QtyBreak[] | 'invalid' {
  if (!s.trim()) return [];
  const out: QtyBreak[] = [];
  for (const part of s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.replace(/[.\s₫đ]/gi, '').match(/^(\d+)[:=](\d+)$/);
    if (!m) return 'invalid';
    out.push({ minQty: Number(m[1]), price: Number(m[2]) });
  }
  return out;
}
export const formatBreaksText = (b: QtyBreak[] | null) => (b ?? []).map((x) => `${x.minQty}:${x.price}`).join('; ');

const PRICE_COLUMNS = ['SKU*', 'Tên sản phẩm', 'Giá sỉ*', 'SL tối thiểu', 'Bậc giá (SL:giá; …)'] as const;

/** GET /price-lists/:id/export — also the import template (fill / edit, then import back). */
export async function exportPriceList(ctx: ServiceContext, priceListId: string) {
  assertAuthorized(actorOf(ctx), 'priceList.manage');
  const { list, items } = await getPriceListItems(ctx, priceListId);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(list.name.slice(0, 31));
  ws.columns = PRICE_COLUMNS.map((header, i) => ({ header, width: [16, 48, 14, 12, 28][i] }));
  for (const it of items) ws.addRow([it.product.sku, it.product.name, Number(it.price), it.minQty, formatBreaksText(parseQtyBreaks(it.qtyBreaks))]);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return { fileName: `bang-gia-${list.tier.toLowerCase()}.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

/** POST /price-lists/:id/import — all-or-nothing: any bad row → nothing changes, errors per row. */
export async function importPriceList(ctx: ServiceContext, priceListId: string, buffer: ArrayBuffer | Buffer) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'priceList.manage');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as ArrayBuffer);
  } catch {
    throw new DomainError('VALIDATION_ERROR', 'Không đọc được file Excel (.xlsx)');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new DomainError('VALIDATION_ERROR', 'File không có trang tính');
  const products = await ctx.db.product.findMany({ where: { orgId: ctx.orgId }, select: { id: true, sku: true } });
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p.id]));
  const rows: z.input<typeof PriceItemInput>[] = [];
  const errors: { row: number; message: string }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const sku = cellText(row.getCell(1).value);
    if (!sku) return;
    const productId = bySku.get(sku.toLowerCase());
    const price = parseNumber(row.getCell(3).value);
    const minQty = parseNumber(row.getCell(4).value);
    const breaks = parseBreaksText(cellText(row.getCell(5).value));
    if (!productId) errors.push({ row: n, message: `Không có sản phẩm mã ${sku}` });
    else if (price === null || price === 'invalid' || price < 0) errors.push({ row: n, message: 'Giá sỉ không hợp lệ' });
    else if (minQty === 'invalid' || (minQty !== null && minQty < 1)) errors.push({ row: n, message: 'SL tối thiểu không hợp lệ' });
    else if (breaks === 'invalid') errors.push({ row: n, message: 'Bậc giá phải dạng "24:95000; 48:90000"' });
    else rows.push({ productId, price: Math.round(price), minQty: minQty ?? 1, qtyBreaks: breaks.length ? breaks : null });
  });
  if (errors.length) return { applied: false as const, errors, rows: rows.length };
  if (!rows.length) throw new DomainError('VALIDATION_ERROR', 'File không có dòng giá nào');
  try {
    const r = await upsertPriceListItems(ctx, priceListId, rows);
    return { applied: true as const, errors: [], rows: r.upserted };
  } catch (err) {
    if (err instanceof DomainError) return { applied: false as const, errors: [{ row: 0, message: err.message }], rows: rows.length };
    throw err;
  }
}

// ---------- WooCommerce (SPEC 5.6) ----------

export interface WooCredentials {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface WooSyncState {
  lastSyncAt?: string | null;
  lastFullSyncAt?: string | null;
  lastResult?: { created: number; updated: number; categories: number; pages: number; mode: 'full' | 'incremental' | 'single' } | null;
  lastError?: string | null;
}

export async function wooAccount(db: PrismaClient | Tx, orgId: string) {
  return db.channelAccount.findFirst({ where: { orgId, type: 'WOOCOMMERCE' }, orderBy: { createdAt: 'asc' } });
}

/** Stored (encrypted) keys win over env WOO_* so the Owner can change them in Cài đặt. */
export async function wooCredentials(db: PrismaClient | Tx, orgId: string): Promise<WooCredentials | null> {
  const a = await wooAccount(db, orgId);
  if (a?.credentials) return decryptJson<WooCredentials>(a.credentials);
  const { WOO_BASE_URL: baseUrl, WOO_CONSUMER_KEY: consumerKey, WOO_CONSUMER_SECRET: consumerSecret } = process.env;
  return baseUrl && consumerKey && consumerSecret ? { baseUrl, consumerKey, consumerSecret } : null;
}

export const WooSettingsInput = z.object({
  baseUrl: z.url('Địa chỉ website không hợp lệ').refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'Cần HTTPS'),
  consumerKey: z.string().trim().regex(/^ck_[a-f0-9]{20,}$/i, 'Consumer Key dạng ck_…'),
  consumerSecret: z.string().trim().regex(/^cs_[a-f0-9]{20,}$/i, 'Consumer Secret dạng cs_…'),
});

/** POST /integrations/woocommerce — save keys (Read only) encrypted. */
export async function saveWooSettings(ctx: ServiceContext, raw: z.input<typeof WooSettingsInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'integration.manage');
  const input = WooSettingsInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const existing = await wooAccount(tx, ctx.orgId);
    const data = { name: `WooCommerce ${new URL(input.baseUrl).host}`, externalId: input.baseUrl.replace(/\/$/, ''), status: 'ACTIVE' as const, credentials: encryptJson(input) };
    const a = existing ? await tx.channelAccount.update({ where: { id: existing.id }, data }) : await tx.channelAccount.create({ data: { orgId: ctx.orgId, type: 'WOOCOMMERCE', ...data } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'integration.woocommerce.save', entityType: 'ChannelAccount', entityId: a.id, after: { baseUrl: data.externalId }, ip: ctx.ip });
    return { id: a.id, baseUrl: data.externalId };
  });
}

export async function wooStatus(ctx: ServiceContext) {
  assertAuthorized(actorOf(ctx), 'integration.manage');
  const a = await wooAccount(ctx.db, ctx.orgId);
  const creds = await wooCredentials(ctx.db, ctx.orgId);
  const [products, needsSku, outOfStock] = await Promise.all([
    ctx.db.product.count({ where: { orgId: ctx.orgId, wooId: { not: null } } }),
    ctx.db.product.count({ where: { orgId: ctx.orgId, needsSku: true } }),
    ctx.db.product.count({ where: { orgId: ctx.orgId, inStock: false, isActive: true } }),
  ]);
  return {
    configured: Boolean(creds),
    source: (a?.credentials ? 'settings' : creds ? 'env' : null) as 'settings' | 'env' | null,
    baseUrl: creds?.baseUrl ?? null,
    status: a?.status ?? null,
    state: ((a?.meta as WooSyncState | null) ?? {}) as WooSyncState,
    counts: { products, needsSku, outOfStock },
  };
}

async function upsertWooCategories(db: PrismaClient, orgId: string, client: WooClient) {
  const map = new Map<number, string>();
  let page = 1;
  let total = 1;
  do {
    const r = await client.listCategories(page);
    total = r.totalPages;
    for (const c of r.items) {
      const row = await db.productCategory.upsert({
        where: { orgId_wooId: { orgId, wooId: c.id } },
        create: { orgId, wooId: c.id, name: c.name },
        update: { name: c.name },
      });
      map.set(c.id, row.id);
    }
    page++;
  } while (page <= total && page < 100);
  // Parents after all rows exist.
  return map;
}

/**
 * `woo-product-sync` (SPEC 5.6): first run / `full` reads everything (paginated); later runs only
 * products modified since the last successful sync (minus a small overlap). Matches by wooId, then
 * SKU (so products created by hand / import get linked), else creates. Never touches wholesale fields.
 */
export async function syncWooProducts(rt: { db: PrismaClient; now: () => Date; effects: ServiceContext['effects'] }, orgId: string, client: WooClient, opts: { full?: boolean; actorId?: string | null } = {}) {
  const startedAt = rt.now();
  const account = await wooAccount(rt.db, orgId);
  const state = ((account?.meta as WooSyncState | null) ?? {}) as WooSyncState;
  const full = opts.full || !state.lastSyncAt;
  const modifiedAfter = full ? undefined : new Date(new Date(state.lastSyncAt!).getTime() - WOOCOMMERCE.overlapMinutes * 60_000);
  let created = 0;
  let updated = 0;
  let pages = 0;
  try {
    const catMap = await upsertWooCategories(rt.db, orgId, client);
    let page = 1;
    let totalPages = 1;
    do {
      const r = await client.listProducts({ page, modifiedAfter });
      totalPages = r.totalPages;
      pages++;
      for (const raw of r.items) {
        const m = mapWooProduct(raw);
        const data = {
          name: m.name, brand: m.brand, imageUrl: m.imageUrl, productUrl: m.productUrl, retailPrice: m.retailPrice, inStock: m.inStock, isActive: m.isActive,
          categoryIds: m.wooCategoryIds.map((id) => catMap.get(id)).filter((x): x is string => !!x), wooModifiedAt: m.wooModifiedAt,
        };
        const existing =
          (await rt.db.product.findUnique({ where: { orgId_wooId: { orgId, wooId: m.wooId } } })) ??
          (m.needsSku ? null : await rt.db.product.findUnique({ where: { orgId_sku: { orgId, sku: m.sku } } }));
        if (existing) {
          // A SKU added on the website replaces our temporary woo-{id}; a SKU typed in Michio Hub is kept.
          const sku = existing.needsSku && !m.needsSku ? m.sku : existing.sku;
          await rt.db.product.update({ where: { id: existing.id }, data: { ...data, wooId: m.wooId, sku, needsSku: existing.needsSku && m.needsSku } });
          updated++;
        } else {
          await rt.db.product.create({ data: { orgId, ...data, wooId: m.wooId, sku: m.sku, needsSku: m.needsSku } });
          created++;
        }
      }
      page++;
    } while (page <= totalPages && page < 1000);
    const meta: WooSyncState = {
      ...state,
      lastSyncAt: startedAt.toISOString(),
      ...(full ? { lastFullSyncAt: startedAt.toISOString() } : {}),
      lastResult: { created, updated, categories: catMap.size, pages, mode: full ? 'full' : 'incremental' },
      lastError: null,
    };
    await saveWooState(rt.db, orgId, account?.id ?? null, meta, 'ACTIVE');
    await recordAudit(rt.db, { orgId, actorId: opts.actorId ?? null, via: opts.actorId ? 'WEB' : 'SYSTEM', action: 'woocommerce.sync', entityType: 'ChannelAccount', entityId: account?.id ?? 'woocommerce', after: meta.lastResult as Prisma.InputJsonValue });
    return meta.lastResult!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveWooState(rt.db, orgId, account?.id ?? null, { ...state, lastError: message.slice(0, 300) }, 'ERROR');
    if (state.lastError === null || state.lastError === undefined) {
      // Tell Owners once per failure streak (SPEC §9: "lỗi kênh cuối cùng báo Owner").
      const outbox = new Outbox(rt.effects);
      await rt.db.$transaction(async (tx) =>
        notifyUsers(tx, outbox, orgId, await managerIds(tx, orgId), { type: 'system', title: '🚨 Đồng bộ WooCommerce lỗi', body: message.slice(0, 200), link: '/cai-dat/woocommerce' }),
      );
      await outbox.flush();
    }
    throw err;
  }
}

async function saveWooState(db: PrismaClient, orgId: string, accountId: string | null, meta: WooSyncState, status: 'ACTIVE' | 'ERROR') {
  if (accountId) {
    await db.channelAccount.update({ where: { id: accountId }, data: { meta: meta as Prisma.InputJsonValue, status } });
  } else {
    // Keys from env (or mocks): keep sync state on a credential-less account row.
    await db.channelAccount.upsert({
      where: { orgId_type_externalId: { orgId, type: 'WOOCOMMERCE', externalId: process.env.WOO_BASE_URL ?? 'woocommerce' } },
      create: { orgId, type: 'WOOCOMMERCE', name: 'WooCommerce', externalId: process.env.WOO_BASE_URL ?? 'woocommerce', status, meta: meta as Prisma.InputJsonValue },
      update: { status, meta: meta as Prisma.InputJsonValue },
    });
  }
}

/** Mock catalog with MOCK_INTEGRATIONS=true; otherwise the shop's REST API (null when no keys). */
export async function createWooClientFor(db: PrismaClient, orgId: string): Promise<WooClient | null> {
  if (isMockIntegrations()) return createWooMockClient();
  const creds = await wooCredentials(db, orgId);
  return creds ? createWooHttpClient(creds) : null;
}
