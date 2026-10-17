// M4 Definition of Done: báo giá theo cấp khách → gửi → chốt → đơn; plus SPEC §12 "báo giá → đơn →
// lifecycle + nextReorderAt", price lists, WooCommerce sync, pipeline.
import { createWooMockClient } from '@michio/integrations';
import type { QuotePdfData } from '@michio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, nextPhone, type TestOrg, testDb, vn } from '../test/fixtures';
import { acceptLead } from './assignment';
import { exportPriceList, importPriceList, savePriceList, syncWooProducts, upsertPriceListItems } from './catalog';
import { getPipeline, moveDealStage } from './deals';
import { intakeLead } from './leads';
import { computeReorderCycle, createOrder, updateOrderDelivery, updateOrderPayment } from './orders';
import { resolvePrices } from './pricing';
import { approveQuote, createQuote, expireQuotes, generateQuotePdf, quoteToOrder, repeatOrderAsQuote, respondQuote, sendQuote } from './quotes';
import { setSetting } from './settings';
import { createMemoryStorage } from './storage';

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
const db = testDb();
afterAll(() => db.$disconnect());

const STAGES = [
  { code: 'MOI', name: 'Mới', order: 1, probability: 10 },
  { code: 'DA_LIEN_HE', name: 'Đã liên hệ', order: 2, probability: 20 },
  { code: 'TU_VAN', name: 'Tư vấn nhóm hàng', order: 3, probability: 40 },
  { code: 'BAO_GIA', name: 'Đã gửi báo giá', order: 4, probability: 60 },
  { code: 'CHOT', name: 'Chốt đơn', order: 5, probability: 100, isWon: true },
  { code: 'THUA', name: 'Không thành công', order: 6, probability: 0, isLost: true },
];

interface World {
  org: TestOrg;
  products: { id: string; sku: string }[];
  si1: string;
  daiLy: string;
}

async function world(): Promise<World> {
  const org = await createTestOrg();
  await db.pipelineStage.createMany({ data: STAGES.map((s) => ({ orgId: org.orgId, isWon: false, isLost: false, ...s })) });
  await db.lostReason.createMany({ data: ['Giá cao hơn nguồn khác', 'Khác'].map((name) => ({ orgId: org.orgId, name })) });
  const products = [];
  for (let i = 1; i <= 25; i++) {
    products.push(await db.product.create({ data: { orgId: org.orgId, sku: `T-${org.orgId.slice(-4)}-${i}`, name: `Sản phẩm thử ${i}`, unit: 'gói', unitsPerCase: 24, retailPrice: 100_000 + i * 1000 } }));
  }
  const owner = org.ctx({ actor: org.owner });
  const si1 = await savePriceList(owner, null, { name: 'Sỉ cấp 1', tier: 'SI_1' });
  const daiLy = await savePriceList(owner, null, { name: 'Đại lý', tier: 'DAI_LY' });
  // Product 25 deliberately has no wholesale price.
  await upsertPriceListItems(owner, si1.id, products.slice(0, 24).map((p, i) => ({ productId: p.id, price: 80_000 + i * 1000, minQty: 6, qtyBreaks: [{ minQty: 24, price: 75_000 + i * 1000 }] })));
  await upsertPriceListItems(owner, daiLy.id, products.slice(0, 24).map((p, i) => ({ productId: p.id, price: 70_000 + i * 1000, minQty: 24 })));
  return { org, products, si1: si1.id, daiLy: daiLy.id };
}

/** A lead accepted by its assignee (round robin), so it is IN_PROGRESS. */
async function workingLead(w: World, now = vn('2026-10-15T09:00:00')) {
  const r = await intakeLead(w.org.ctx({ now }), { source: 'MANUAL', fullName: 'Shop Thử', phone: nextPhone(), shopName: 'Shop Thử', province: 'Hải Phòng' });
  const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId } });
  const sales = w.org.sales.find((s) => s.id === lead.ownerId)!;
  await acceptLead(w.org.ctx({ actor: sales, now }), lead.id);
  return { lead, sales, customerId: r.customerId };
}

const fakeRenderer = async (d: QuotePdfData) => Buffer.from(`%PDF-fake ${d.code} ${d.lines.length} ${d.total}`);

describe('pricing by tier and quantity', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it('uses the customer tier, quantity breaks and flags retail fallbacks', async () => {
    const { sales, customerId } = await workingLead(w);
    const ctx = w.org.ctx({ actor: sales });
    const base = await resolvePrices(ctx, { customerId, items: [{ productId: w.products[0]!.id, qty: 12 }, { productId: w.products[0]!.id, qty: 24 }, { productId: w.products[24]!.id, qty: 1 }] });
    expect(base.priceList?.tier).toBe('SI_1'); // no tier → base list
    expect(base.lines.map((l) => [l.unitPrice, l.source])).toEqual([[80_000, 'PRICE_LIST'], [75_000, 'PRICE_LIST'], [125_000, 'RETAIL']]);
    expect((await resolvePrices(ctx, { customerId, items: [{ productId: w.products[0]!.id, qty: 2 }] })).lines[0]!.belowMinQty).toBe(true);

    await db.customer.update({ where: { id: customerId }, data: { tier: 'DAI_LY' } });
    const agent = await resolvePrices(ctx, { customerId, items: [{ productId: w.products[1]!.id, qty: 24 }] });
    expect(agent.priceList?.tier).toBe('DAI_LY');
    expect(agent.lines[0]!.unitPrice).toBe(71_000);
    // Another salesperson cannot price this customer.
    const other = w.org.sales.find((s) => s.id !== sales.id)!;
    await expect(resolvePrices(w.org.ctx({ actor: other }), { customerId, items: [{ productId: w.products[0]!.id, qty: 1 }] })).rejects.toThrow();
  });
});

describe('quote → send → accept → order (M4 DoD)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it('a 20-line quote: approval for extra discount, send, PDF, deal BAO_GIA, one follow-up task, order, lifecycle', async () => {
    const now = vn('2026-10-16T10:00:00'); // Friday
    const { lead, sales, customerId } = await workingLead(w, now);
    const ctx = w.org.ctx({ actor: sales, now });
    await setSetting(db, w.org.orgId, 'quote.maxExtraDiscountPct', 3);

    const items = w.products.slice(0, 20).map((p, i) => ({ productId: p.id, qty: 24, discountPct: i === 0 ? 5 : 0 }));
    const q = await createQuote(ctx, { customerId, items, shippingFee: 50_000 });
    expect(q.code).toMatch(/^BG-2026-\d{6}$/);
    expect(q.status).toBe('PENDING_APPROVAL'); // 5% > 3% by a salesperson
    expect(await db.notification.count({ where: { userId: w.org.owner.id, type: 'quote.approval' } })).toBe(1);
    expect(Number(q.subtotal)).toBe(items.reduce((s, _, i) => s + 24 * (75_000 + i * 1000), 0));
    expect(Number(q.discount)).toBe(Math.round((24 * 75_000 * 5) / 100));
    expect(Number(q.total)).toBe(Number(q.subtotal) - Number(q.discount) + 50_000);
    await expect(sendQuote(ctx, q.id)).rejects.toThrow('chờ Owner duyệt');
    await expect(approveQuote(ctx, q.id)).rejects.toThrow(); // sales cannot approve

    await approveQuote(w.org.ctx({ actor: w.org.owner, now }), q.id);
    const sent = await sendQuote(ctx, q.id, { via: 'MANUAL' });
    expect(sent.status).toBe('SENT');
    expect(ctx.effects.pdfJobs).toEqual([{ quoteId: q.id, sendToConversationId: null, userId: sales.id }]);
    await sendQuote(ctx, q.id); // resend: still one follow-up task
    const tasks = await db.task.findMany({ where: { quoteId: q.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type: 'FOLLOW_UP', assigneeId: sales.id });
    expect(tasks[0]!.dueAt).toEqual(vn('2026-10-19T10:00:00')); // Fri + 2 working days (Sat, Mon)
    const deal = await db.deal.findFirstOrThrow({ where: { leadId: lead.id }, include: { stage: true } });
    expect(deal.stage.code).toBe('BAO_GIA');

    const storage = createMemoryStorage();
    const pdf = await generateQuotePdf({ db, now: () => now }, q.id, fakeRenderer, storage, { fetchImages: false });
    expect(storage.files.get(pdf.key)?.body.toString()).toContain(`${q.code} 20`);
    expect((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).pdfKey).toBe(pdf.key);

    await respondQuote(ctx, q.id, 'ACCEPTED');
    const later = vn('2026-10-17T09:00:00');
    const order = await quoteToOrder(w.org.ctx({ actor: sales, now: later }), q.id, { paymentMethod: 'BANK_TRANSFER' });
    expect(order.code).toMatch(/^DH-2026-\d{6}$/);
    expect(Number(order.total)).toBe(Number(q.total));
    expect(order.items).toHaveLength(20);
    await expect(quoteToOrder(ctx, q.id)).rejects.toThrow('đã thành đơn');

    const c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(c).toMatchObject({ lifecycle: 'NEW_CUSTOMER', orderCount: 1, ownerId: sales.id, reorderCycleDays: 30 });
    expect(c.nextReorderAt).toEqual(new Date(later.getTime() + 30 * 86_400_000));
    expect(Number(c.totalRevenue)).toBe(Number(order.total));
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('WON');
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id }, include: { stage: true } })).stage.code).toBe('CHOT');
    expect((await db.task.findFirstOrThrow({ where: { quoteId: q.id } })).status).toBe('DONE');
    expect(await db.auditLog.count({ where: { entityId: order.id, action: 'order.create' } })).toBe(1);

    // "Tạo đơn lặp lại": a new draft quote with the same lines at today's prices.
    const again = await repeatOrderAsQuote(w.org.ctx({ actor: sales, now: later }), order.id);
    expect(again.status).toBe('DRAFT');
    expect((again.items as unknown[]).length).toBe(20);
  });

  it('payment / delivery are for accounting; delivery tells the sales; cancelling recomputes stats', async () => {
    const { sales, customerId } = await workingLead(w);
    const support = await db.user.create({ data: { orgId: w.org.orgId, email: `kt-${Date.now()}@t.local`, fullName: 'Kế toán', role: 'SUPPORT', passwordHash: 'x' } });
    const supportActor = { id: support.id, orgId: w.org.orgId, role: support.role, status: support.status, deletedAt: null };
    const t0 = vn('2026-08-01T09:00:00');
    const mk = (days: number) => createOrder(w.org.ctx({ actor: sales, now: new Date(t0.getTime() + days * 86_400_000) }), { customerId, items: [{ productId: w.products[3]!.id, qty: 24 }] });
    const o1 = await mk(0);
    await mk(20);
    const o3 = await mk(44); // gaps 20, 24 → median 22
    let c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(c).toMatchObject({ orderCount: 3, lifecycle: 'REPEAT', reorderCycleDays: 22 });

    await expect(updateOrderPayment(w.org.ctx({ actor: sales }), o1.id, { paymentStatus: 'PAID' })).rejects.toThrow();
    const sctx = w.org.ctx({ actor: supportActor });
    await expect(updateOrderPayment(sctx, o1.id, { paymentStatus: 'PARTIAL', paidAmount: 0 })).rejects.toThrow('một phần');
    expect(Number((await updateOrderPayment(sctx, o1.id, { paymentStatus: 'PAID' })).paidAmount)).toBe(Number(o1.total));
    await updateOrderDelivery(sctx, o1.id, { deliveryStatus: 'DELIVERED', trackingCode: 'GHN123' });
    expect(await db.notification.count({ where: { userId: sales.id, type: 'order.delivered' } })).toBe(1);

    await updateOrderDelivery(sctx, o3.id, { deliveryStatus: 'CANCELLED', reason: 'Khách đổi ý' });
    c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(c.orderCount).toBe(2);
    expect(c.reorderCycleDays).toBe(30); // < 3 orders → default
    await expect(updateOrderDelivery(sctx, o3.id, { deliveryStatus: 'SHIPPING' })).rejects.toThrow('đã hủy');
  });

  it('expires sent quotes after validUntil', async () => {
    const now = vn('2026-10-15T09:00:00');
    const { sales, customerId } = await workingLead(w, now);
    const q = await createQuote(w.org.ctx({ actor: sales, now }), { customerId, items: [{ productId: w.products[0]!.id, qty: 6 }] });
    await sendQuote(w.org.ctx({ actor: sales, now }), q.id);
    expect((await expireQuotes(w.org.ctx({ now: vn('2026-10-22T23:00:00') }))).expired).toBe(0);
    await expireQuotes(w.org.ctx({ now: vn('2026-10-23T00:00:01') }));
    expect((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('EXPIRED');
  });
});

describe('reorder cycle', () => {
  it('is the median gap after ≥ 3 orders, clamped 7–120', () => {
    const d = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
    expect(computeReorderCycle([d(0), d(30)])).toBeNull();
    expect(computeReorderCycle([d(0), d(20), d(44)])).toBe(22);
    expect(computeReorderCycle([d(60), d(0), d(30), d(100)])).toBe(30); // unsorted input, gaps 30,30,40
    expect(computeReorderCycle([d(0), d(1), d(3)])).toBe(7);
    expect(computeReorderCycle([d(0), d(200), d(400)])).toBe(120);
  });
});

describe('pipeline', () => {
  it('shows working leads in "Mới" and requires a reason to lose', async () => {
    const w = await world();
    const { lead, sales } = await workingLead(w);
    const ctx = w.org.ctx({ actor: sales });
    const board = await getPipeline(ctx);
    expect(board.columns[0]!.cards.map((c) => c.leadId)).toContain(lead.id);
    await moveDealStage(ctx, `lead-${lead.id}`, { stage: 'TU_VAN' });
    const deal = await db.deal.findFirstOrThrow({ where: { leadId: lead.id } });
    expect((await getPipeline(ctx)).columns.find((c) => c.code === 'TU_VAN')!.cards.map((c) => c.dealId)).toContain(deal.id);
    await expect(moveDealStage(ctx, deal.id, { stage: 'THUA' })).rejects.toThrow('lý do');
    await moveDealStage(ctx, deal.id, { stage: 'THUA', lostReasonId: board.lostReasons[0]!.id });
    expect(await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ lostReasonId: board.lostReasons[0]!.id });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('LOST');
  });
});

describe('price list Excel', () => {
  it('exports, re-imports edits, and rejects a bad file without changing anything', async () => {
    const w = await world();
    const ctx = w.org.ctx({ actor: w.org.manager });
    const { buffer } = await exportPriceList(ctx, w.si1);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBe(25); // header + 24
    ws.getRow(2).getCell(3).value = 99_000;
    ws.getRow(2).getCell(5).value = '48:90000; 96:85000';
    ws.addRow([w.products[24]!.sku, '', 150_000, 1, '']);
    const r = await importPriceList(ctx, w.si1, Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r).toMatchObject({ applied: true, rows: 25 });
    const item = await db.priceListItem.findFirstOrThrow({ where: { priceListId: w.si1, product: { sku: String(ws.getRow(2).getCell(1).value) } } });
    expect(Number(item.price)).toBe(99_000);
    expect(item.qtyBreaks).toEqual([{ minQty: 48, price: 90_000 }, { minQty: 96, price: 85_000 }]);

    ws.getRow(3).getCell(3).value = 'abc';
    ws.addRow(['KHONG-CO', '', 1000]);
    const bad = await importPriceList(ctx, w.si1, Buffer.from(await wb.xlsx.writeBuffer()));
    expect(bad.applied).toBe(false);
    expect(bad.errors.map((e) => e.row)).toEqual([3, 27]);
    // Sales may not touch price lists.
    await expect(importPriceList(w.org.ctx({ actor: w.org.sales[0]! }), w.si1, buffer)).rejects.toThrow();
  });
});

describe('WooCommerce sync', () => {
  it('full sync creates products and categories; incremental picks only changes; never duplicates', async () => {
    const org = await createTestOrg();
    const woo = createWooMockClient();
    const rt = { db, now: () => vn('2026-10-15T09:00:00'), effects: org.ctx().effects };
    expect(await syncWooProducts(rt, org.orgId, woo)).toMatchObject({ created: 8, updated: 0, categories: 5, pages: 2, mode: 'full' });
    const noSku = await db.product.findFirstOrThrow({ where: { orgId: org.orgId, wooId: 5006 } });
    expect(noSku).toMatchObject({ sku: 'woo-5006', needsSku: true });
    expect((await db.product.findFirstOrThrow({ where: { orgId: org.orgId, wooId: 5004 } })).inStock).toBe(false);
    // Wholesale fields set in Michio Hub survive a sync.
    await db.product.update({ where: { id: noSku.id }, data: { unitsPerCase: 12, showInQuote: false } });

    woo.touch(5006, { sku: 'WOO-DU-01', stock_status: 'outofstock' }, vn('2026-10-15T10:00:00'));
    const later = { ...rt, now: () => vn('2026-10-15T15:00:00') };
    expect(await syncWooProducts(later, org.orgId, woo)).toMatchObject({ created: 0, updated: 1, mode: 'incremental' });
    expect(await db.product.findUniqueOrThrow({ where: { id: noSku.id } })).toMatchObject({ sku: 'WOO-DU-01', needsSku: false, inStock: false, unitsPerCase: 12, showInQuote: false });
    expect(await syncWooProducts(later, org.orgId, woo, { full: true })).toMatchObject({ created: 0, updated: 8 });
    expect(await db.product.count({ where: { orgId: org.orgId } })).toBe(8);
  });
});
