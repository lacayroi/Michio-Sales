// M5 Definition of Done: số liệu báo cáo khớp fixture; task tái đặt tạo đúng hạn, không trùng.
// Plus SPEC §12: "job reorder tạo task đúng 1 lần", "chuyển giao 1.000 bản ghi".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, nextPhone, type TestOrg, testDb, vn } from '../test/fixtures';
import { createReorderReminders, listAttention, refreshLifecycles, warnStaleLeads } from './care';
import { listAuditLogs, listTargets, saveTargets } from './governance';
import { createOrder } from './orders';
import { exportReport, getReport } from './reports';
import { listTasks } from './tasks';
import { previewTransfer, runTransfer } from './transfers';

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

async function stages(orgId: string) {
  await db.pipelineStage.createMany({ data: STAGES.map((s) => ({ orgId, isWon: false, isLost: false, ...s })) });
  const all = await db.pipelineStage.findMany({ where: { orgId } });
  return Object.fromEntries(all.map((s) => [s.code, s.id])) as Record<string, string>;
}

let codeSeq = 900_000;
const mkCustomer = (orgId: string, ownerId: string | null, over: Record<string, unknown> = {}) =>
  db.customer.create({ data: { orgId, contactName: `KH ${++codeSeq}`, phone: nextPhone(), ownerId, ...over } });

describe('reports match a hand-computed fixture (M5 DoD)', () => {
  let org: TestOrg;
  const OCT = { from: vn('2026-10-01T00:00:00'), to: vn('2026-11-01T00:00:00') };
  beforeAll(async () => {
    org = await createTestOrg();
    const [s0, s1, s2] = org.sales;
    const st = await stages(org.orgId);
    const reason = await db.lostReason.create({ data: { orgId: org.orgId, name: 'Giá cao hơn nguồn khác' } });
    const product = await db.product.create({ data: { orgId: org.orgId, sku: `R-${org.orgId.slice(-5)}`, name: 'Matcha', retailPrice: 100_000 } });

    const lead = async (o: { owner: string; source: 'WEBSITE_WHOLESALE_FORM' | 'FACEBOOK_MESSENGER' | 'ZALO_COMPANY'; created: string; assigned: string; contact?: string; status: 'ASSIGNED' | 'IN_PROGRESS' | 'WON' | 'LOST' }) => {
      const c = await mkCustomer(org.orgId, o.owner);
      return db.lead.create({
        data: {
          orgId: org.orgId, code: ++codeSeq, customerId: c.id, source: o.source, status: o.status, ownerId: o.owner, createdAt: vn(o.created),
          firstAssignedAt: vn(o.assigned), firstContactAt: o.contact ? vn(o.contact) : null,
        },
      });
    };
    const l1 = await lead({ owner: s0!.id, source: 'WEBSITE_WHOLESALE_FORM', created: '2026-10-15T09:00:00', assigned: '2026-10-15T09:00:00', contact: '2026-10-15T09:12:00', status: 'WON' });
    const l2 = await lead({ owner: s0!.id, source: 'FACEBOOK_MESSENGER', created: '2026-10-15T11:50:00', assigned: '2026-10-15T11:50:00', contact: '2026-10-15T13:40:00', status: 'LOST' });
    const l3 = await lead({ owner: s1!.id, source: 'FACEBOOK_MESSENGER', created: '2026-10-17T17:20:00', assigned: '2026-10-17T17:20:00', contact: '2026-10-19T08:15:00', status: 'IN_PROGRESS' });
    const l4 = await lead({ owner: s2!.id, source: 'ZALO_COMPANY', created: '2026-10-19T09:00:00', assigned: '2026-10-19T09:00:00', status: 'ASSIGNED' });
    await lead({ owner: s0!.id, source: 'ZALO_COMPANY', created: '2026-09-20T09:00:00', assigned: '2026-09-20T09:00:00', contact: '2026-09-20T09:05:00', status: 'IN_PROGRESS' }); // outside October

    const dl = (leadId: string, customerId: string, owner: string, stage: string, closed?: string, lostReasonId?: string) =>
      db.deal.create({ data: { orgId: org.orgId, leadId, customerId, ownerId: owner, stageId: st[stage]!, title: 'x', closedAt: closed ? vn(closed) : null, lostReasonId } });
    await dl(l1.id, l1.customerId, s0!.id, 'CHOT', '2026-10-16T10:00:00');
    await dl(l2.id, l2.customerId, s0!.id, 'THUA', '2026-10-16T11:00:00', reason.id);
    const d3 = await dl(l3.id, l3.customerId, s1!.id, 'BAO_GIA');
    await db.quote.create({ data: { orgId: org.orgId, code: `BG-T-${codeSeq}`, customerId: l3.customerId, dealId: d3.id, ownerId: s1!.id, status: 'SENT', items: [], subtotal: 1, total: 1, validUntil: vn('2026-10-30T00:00:00'), sentAt: vn('2026-10-19T10:00:00') } });

    const as = (leadId: string, userId: string, status: 'ACCEPTED' | 'EXPIRED' | 'PENDING', created: string, deadline: string, responded?: string) =>
      db.leadAssignment.create({ data: { leadId, userId, method: 'ROUND_ROBIN', status, createdAt: vn(created), acceptDeadline: vn(deadline), respondedAt: responded ? vn(responded) : null } });
    await as(l1.id, s0!.id, 'ACCEPTED', '2026-10-15T09:00:00', '2026-10-15T09:10:00', '2026-10-15T09:05:00'); // on time
    await as(l2.id, s0!.id, 'ACCEPTED', '2026-10-15T11:50:00', '2026-10-15T13:30:00', '2026-10-15T13:35:00'); // late
    await as(l3.id, s2!.id, 'EXPIRED', '2026-10-17T17:20:00', '2026-10-19T08:00:00');
    await as(l3.id, s1!.id, 'ACCEPTED', '2026-10-19T08:01:00', '2026-10-19T08:11:00', '2026-10-19T08:05:00'); // on time
    await as(l4.id, s2!.id, 'PENDING', '2026-10-19T09:00:00', '2026-10-19T09:10:00');

    // Orders: C1 first order 10M (s0); C6 returning 5M (s1, had an August order); one cancelled.
    const c6 = await mkCustomer(org.orgId, s1!.id);
    const order = (customerId: string, owner: string, at: string, total: number, cancelled = false) =>
      createOrder(org.ctx({ actor: org.owner, now: vn(at) }), { customerId, items: [{ productId: product.id, qty: 1, unitPrice: total }], orderedAt: vn(at) }).then(async (o) => {
        await db.order.update({ where: { id: o.id }, data: { ownerId: owner, ...(cancelled ? { deliveryStatus: 'CANCELLED' } : {}) } });
        return o;
      });
    await order(c6.id, s1!.id, '2026-08-10T10:00:00', 3_000_000);
    await order(l1.customerId, s0!.id, '2026-10-16T10:00:00', 10_000_000);
    await order(c6.id, s1!.id, '2026-10-18T10:00:00', 5_000_000);
    await order(l2.customerId, s0!.id, '2026-10-20T10:00:00', 99_000_000, true);
    await db.customer.update({ where: { id: l2.customerId }, data: { firstOrderAt: null, orderCount: 0 } }); // only a cancelled order
    await db.target.create({ data: { orgId: org.orgId, userId: s0!.id, month: '2026-10', revenue: 20_000_000 } });
  });

  const ctx = () => org.ctx({ actor: org.owner, now: vn('2026-10-20T09:00:00') });
  const sum = (r: Awaited<ReturnType<typeof getReport>>, label: string) => r.summary.find((s) => s.label === label)?.value;

  it('overview', async () => {
    const r = await getReport(ctx(), 'overview', OCT);
    expect(sum(r, 'Lead mới')).toBe(4);
    expect(sum(r, 'FRT trung vị (phút)')).toBe(20); // [12, 20, 25]
    expect(sum(r, 'FRT P90 (phút)')).toBe(25);
    expect(sum(r, 'Lần thu hồi')).toBe(1);
    expect(sum(r, 'Tỷ lệ chốt')).toBe(50);
    expect(sum(r, 'Doanh số')).toBe(15_000_000);
    expect(sum(r, 'Số đơn')).toBe(2);
    expect(sum(r, 'Giá trị đơn TB')).toBe(7_500_000);
    expect(sum(r, 'Doanh số khách mới')).toBe(10_000_000);
    expect(sum(r, 'Doanh số khách cũ')).toBe(5_000_000);
    expect(r.rows).toEqual([{ source: 'Facebook Messenger', leads: 2 }, { source: 'Form sỉ', leads: 1 }, { source: 'Zalo công ty', leads: 1 }]);
  });

  it('funnel / sources', async () => {
    const r = await getReport(ctx(), 'sources', OCT);
    const by = Object.fromEntries(r.rows.map((x) => [x.group, x]));
    expect(by['Form sỉ']).toMatchObject({ leads: 1, contacted: 1, quoted: 1, won: 1, lost: 0, rate: 100 });
    expect(by['Facebook Messenger']).toMatchObject({ leads: 2, contacted: 2, quoted: 1, won: 0, lost: 1, rate: 0 });
    expect(by['Zalo công ty']).toMatchObject({ leads: 1, contacted: 0, quoted: 0, won: 0, lost: 0, rate: null });
    expect(by['Tổng']).toMatchObject({ leads: 4, contacted: 3, quoted: 2, won: 1, lost: 1, rate: 50 });
  });

  it('sales comparison, SLA, revenue, customers, lost reasons, products', async () => {
    const [s0, s1] = org.sales;
    const cmp = await getReport(ctx(), 'sales-comparison', OCT);
    const row = (name: string) => cmp.rows.find((r) => r.sales === name)!;
    expect(row('SALES 1')).toMatchObject({ leads: 2, frtMedian: 16, orders: 1, revenue: 10_000_000, newCustomers: 1, rate: 50, target: 20_000_000, targetPct: 50 });
    expect(row('SALES 2')).toMatchObject({ leads: 1, frtMedian: 25, orders: 1, revenue: 5_000_000, quotes: 1, newCustomers: 0, rate: null });

    const sla = await getReport(ctx(), 'sla', OCT);
    expect(sla.rows.find((r) => r.sales === 'SALES 1')).toMatchObject({ assignments: 2, onTimeRate: 50, expired: 0 });
    expect(sla.rows.find((r) => r.sales === 'SALES 3')).toMatchObject({ assignments: 2, onTimeRate: 0, expired: 1 });
    expect(sum(sla, 'Nhận đúng hạn')).toBe(40); // 2 of 5: the pending one is already past its deadline
    const rev = await getReport(ctx(), 'revenue', OCT);
    expect(rev.rows).toHaveLength(31);
    expect(rev.rows.find((r) => r.period === '2026-10-16')).toMatchObject({ orders: 1, revenue: 10_000_000, revenueNew: 10_000_000 });
    expect(rev.rows.find((r) => r.period === '2026-10-18')).toMatchObject({ orders: 1, revenue: 5_000_000, revenueReturning: 5_000_000 });
    const cust = await getReport(ctx(), 'customers', OCT);
    expect(sum(cust, 'Khách mới trong kỳ')).toBe(1);
    expect(sum(cust, 'Tỷ lệ quay lại 2026-Q4')).toBe(100);
    const lost = await getReport(ctx(), 'lost-reasons', OCT);
    expect(lost.rows).toEqual([{ reason: 'Giá cao hơn nguồn khác', count: 1, share: 100 }]);
    const prod = await getReport(ctx(), 'products', OCT);
    expect(prod.rows[0]).toMatchObject({ qty: 2, revenue: 15_000_000, share: 100 });

    // SALES only ever sees their own numbers (§3).
    const mine = await getReport(org.ctx({ actor: s1!, now: vn('2026-10-20T09:00:00') }), 'overview', { ...OCT, ownerId: s0!.id });
    expect(sum(mine, 'Doanh số')).toBe(5_000_000);
    expect(sum(mine, 'Lead mới')).toBe(1);
    // VIEWER-like read-only is allowed, SUPPORT only order reports.
    const support = await db.user.create({ data: { orgId: org.orgId, email: `sp-${codeSeq}@t.local`, fullName: 'KT', role: 'SUPPORT', passwordHash: 'x' } });
    const sctx = org.ctx({ actor: { id: support.id, orgId: org.orgId, role: 'SUPPORT', status: 'AVAILABLE', deletedAt: null }, now: vn('2026-10-20T09:00:00') });
    await expect(getReport(sctx, 'overview', OCT)).rejects.toThrow('quyền');
    expect(sum(await getReport(sctx, 'revenue', OCT), 'Doanh số')).toBe(15_000_000);

    const xlsx = await exportReport(ctx(), 'sales-comparison', OCT);
    expect(xlsx.fileName).toMatch(/^bao-cao-sales-comparison-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(xlsx.buffer.subarray(0, 2).toString()).toBe('PK');
    await expect(exportReport(org.ctx({ actor: s0!, now: vn('2026-10-20T09:00:00') }), 'overview', OCT)).rejects.toThrow('xuất Excel');
  });

  it('targets: Owner sets, actuals computed, sales sees only own', async () => {
    await saveTargets(org.ctx({ actor: org.manager }), { month: '2026-10', rows: [{ userId: org.sales[1]!.id, revenue: 10_000_000, orders: 3 }] });
    const t = await listTargets(org.ctx({ actor: org.owner, now: vn('2026-10-20T09:00:00') }), '2026-10');
    expect(t.rows.find((r) => r.userId === org.sales[1]!.id)).toMatchObject({ target: { revenue: 10_000_000, orders: 3 }, actual: { revenue: 5_000_000, orders: 1 } });
    const own = await listTargets(org.ctx({ actor: org.sales[0]!, now: vn('2026-10-20T09:00:00') }), '2026-10');
    expect(own.rows.map((r) => r.userId)).toEqual([org.sales[0]!.id]);
    await expect(saveTargets(org.ctx({ actor: org.sales[0]! }), { month: '2026-10', rows: [{ userId: org.sales[0]!.id, revenue: 1 }] })).rejects.toThrow();
  });
});

describe('reorder reminders (M5 DoD: đúng hạn, không trùng)', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg();
  });

  it('creates exactly one REORDER task 3 days before nextReorderAt, with top products', async () => {
    const s = org.sales[0]!;
    const p1 = await db.product.create({ data: { orgId: org.orgId, sku: `RR-${codeSeq}-1`, name: 'Trà xanh' } });
    const p2 = await db.product.create({ data: { orgId: org.orgId, sku: `RR-${codeSeq}-2`, name: 'Bánh Kitkat' } });
    const c = await mkCustomer(org.orgId, s.id, { shopName: 'Shop ABC', province: 'Hải Phòng' });
    await createOrder(org.ctx({ actor: s, now: vn('2026-09-20T07:00:00') }), { customerId: c.id, items: [{ productId: p1.id, qty: 10, unitPrice: 100_000 }, { productId: p2.id, qty: 30, unitPrice: 50_000 }], orderedAt: vn('2026-09-20T07:00:00') });
    const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.nextReorderAt).toEqual(vn('2026-10-20T07:00:00'));

    expect((await createReorderReminders(org.ctx({ now: vn('2026-10-16T07:30:00') }))).created).toBe(0); // 4 days before
    expect((await createReorderReminders(org.ctx({ now: vn('2026-10-17T07:30:00') }))).created).toBe(1);
    expect((await createReorderReminders(org.ctx({ now: vn('2026-10-17T07:31:00') }))).created).toBe(0);
    expect((await createReorderReminders(org.ctx({ now: vn('2026-10-19T07:30:00') }))).created).toBe(0);
    const tasks = await db.task.findMany({ where: { customerId: c.id, type: 'REORDER' } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assigneeId: s.id, autoRuleKey: `reorder:${c.id}:2026-10-20` });
    expect(tasks[0]!.dueAt).toEqual(vn('2026-10-17T08:00:00')); // 3 days before = 07:00 → next opening 08:00
    expect(tasks[0]!.note).toContain('1. Bánh Kitkat (30)');
    const n = await db.notification.findFirstOrThrow({ where: { userId: s.id, type: 'reorder.reminder' } });
    expect(n.title).toContain('Shop ABC (Hải Phòng) đã 27 ngày chưa đặt lại, chu kỳ thường 30 ngày');

    // S11: the task shows under "Hôm nay" for the sales.
    const list = await listTasks(org.ctx({ actor: s, now: vn('2026-10-17T07:45:00') }), { bucket: 'today' });
    expect(list.items.map((t) => t.id)).toContain(tasks[0]!.id);

    // S8: the customer is "sắp đến hạn" for the sales, sorted by average order value.
    const att = await listAttention(org.ctx({ actor: s, now: vn('2026-10-17T09:00:00') }));
    expect(att.items.find((i) => i.id === c.id)).toMatchObject({ group: 'due', openTask: { id: tasks[0]!.id } });
  });

  it('lifecycle job moves customers to AT_RISK / DORMANT as time passes', async () => {
    const s = org.sales[1]!;
    const c = await mkCustomer(org.orgId, s.id, { orderCount: 2, lifecycle: 'REPEAT', lastOrderAt: vn('2026-08-25T10:00:00'), reorderCycleDays: 30 });
    const d = await mkCustomer(org.orgId, s.id, { orderCount: 1, lifecycle: 'NEW_CUSTOMER', lastOrderAt: vn('2026-06-01T10:00:00'), reorderCycleDays: 30 });
    const r = await refreshLifecycles(org.ctx({ now: vn('2026-10-17T01:00:00') }));
    expect(r.atRisk).toContain(c.id); // 53 days > 1.5 × 30
    expect((await db.customer.findUniqueOrThrow({ where: { id: d.id } })).lifecycle).toBe('DORMANT');
    expect((await refreshLifecycles(org.ctx({ now: vn('2026-10-17T01:00:00') }))).changed).toBe(0); // idempotent
  });

  it('warns once about leads without activity for 5 days', async () => {
    const s = org.sales[2]!;
    const c = await mkCustomer(org.orgId, s.id);
    await db.lead.create({ data: { orgId: org.orgId, code: ++codeSeq, customerId: c.id, source: 'MANUAL', status: 'IN_PROGRESS', ownerId: s.id, lastActivityAt: vn('2026-10-10T10:00:00') } });
    expect((await warnStaleLeads(org.ctx({ now: vn('2026-10-16T10:00:00') }))).warned).toBe(1);
    expect((await warnStaleLeads(org.ctx({ now: vn('2026-10-16T11:00:00') }))).warned).toBe(0);
  });
});

describe('chuyển giao 1.000 bản ghi', () => {
  it('moves customers with their leads, quotes and tasks round-robin in < 1 minute with full audit', async () => {
    const org = await createTestOrg({ salesCount: 3 });
    const [from, a, b] = org.sales;
    await db.customer.createMany({ data: Array.from({ length: 700 }, (_, i) => ({ orgId: org.orgId, contactName: `KH chuyển ${i}`, ownerId: from!.id, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000) })) });
    const customers = await db.customer.findMany({ where: { orgId: org.orgId, ownerId: from!.id }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    await db.lead.createMany({ data: customers.slice(0, 200).map((c, i) => ({ orgId: org.orgId, code: 5_000_000 + i + Number(org.orgId.length), customerId: c.id, source: 'MANUAL' as const, status: 'IN_PROGRESS' as const, ownerId: from!.id })) }).catch(async () => {
      // codes must be unique per org: fall back to a sequence-safe range
      await db.lead.createMany({ data: customers.slice(0, 200).map((c, i) => ({ orgId: org.orgId, code: 7_000_000 + Math.floor(Math.random() * 1e6) + i, customerId: c.id, source: 'MANUAL' as const, status: 'IN_PROGRESS' as const, ownerId: from!.id })) });
    });
    await db.task.createMany({ data: customers.slice(0, 100).map((c) => ({ orgId: org.orgId, title: 'Gọi lại', type: 'CALL' as const, dueAt: vn('2026-10-20T10:00:00'), assigneeId: from!.id, customerId: c.id })) });

    const ctx = org.ctx({ actor: org.manager });
    expect((await previewTransfer(ctx, from!.id)).counts).toMatchObject({ customers: 700, openLeads: 200, tasks: 100 });
    const started = Date.now();
    const progress: number[] = [];
    const r = await runTransfer(ctx, { fromUserId: from!.id, mode: 'ROUND_ROBIN', toUserIds: [a!.id, b!.id], deactivate: true }, (done) => void progress.push(done));
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(r).toMatchObject({ customers: 700, leads: 200, tasks: 100, deactivated: true });
    expect(r.perUser[a!.id]!.customers + r.perUser[b!.id]!.customers).toBe(700);
    expect(Math.abs(r.perUser[a!.id]!.customers - r.perUser[b!.id]!.customers)).toBeLessThanOrEqual(1);
    expect(progress.at(-1)).toBe(1000);
    expect(await db.customer.count({ where: { orgId: org.orgId, ownerId: from!.id } })).toBe(0);
    // Leads and tasks follow their customer.
    const lead = await db.lead.findFirstOrThrow({ where: { orgId: org.orgId, customerId: customers[0]!.id } });
    const cust = await db.customer.findUniqueOrThrow({ where: { id: customers[0]!.id } });
    expect(lead.ownerId).toBe(cust.ownerId);
    expect((await db.task.findFirstOrThrow({ where: { customerId: customers[0]!.id } })).assigneeId).toBe(cust.ownerId);
    expect(await db.auditLog.count({ where: { orgId: org.orgId, action: { startsWith: 'transfer.' } } })).toBe(1001); // 1.000 records + summary
    expect((await db.user.findUniqueOrThrow({ where: { id: from!.id } })).status).toBe('INACTIVE');
    expect(await db.notification.count({ where: { userId: { in: [a!.id, b!.id] }, type: 'transfer.received' } })).toBe(2);
    // Sales cannot run a transfer.
    await expect(runTransfer(org.ctx({ actor: a! }), { fromUserId: b!.id, mode: 'ONE', toUserId: a!.id })).rejects.toThrow();

    const audit = await listAuditLogs(ctx, { action: 'transfer.run' });
    expect(audit.items).toHaveLength(1);
    expect(audit.actors[org.manager.id]).toBe('MANAGER 1');
  }, 120_000);
});
