import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, phone, type TestOrg, testDb } from '../../test/fixtures';
import { mergeCustomers, mergeSuggestions, updateCustomer } from '../customers/service';
import { recordingEffects } from '../effects';
import { intakeLead } from '../leads/intake';
import { changeOwnPassword, createUser, resetUserPassword } from '../users/service';
import { apiActor } from '../context';
import { buildImportTemplate, IMPORT_COLUMNS, parseCustomerWorkbook, runCustomerImport } from './customers';

const db = testDb();
afterAll(() => db.$disconnect());

async function workbook(rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Khach si');
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key }));
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Excel import (SPEC 6.2, Phụ lục A)', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg(db);
  });

  it('the template parses cleanly', async () => {
    const preview = await parseCustomerWorkbook(db, org.as(org.owner), await buildImportTemplate());
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]).toMatchObject({ phone: '+84912345678', businessModel: 'ONLINE_SHOP', expectedOrderBand: 'B10_30M', orderCount: 3, interestCategories: ['MATCHA_TEA', 'CANDY'] });
  });

  it('preview reports row errors (Vietnamese labels mapped, unknown → error)', async () => {
    const p = phone();
    const buf = await workbook([
      { contactName: 'A', phone: p, businessModel: 'Shop online', expectedOrderBand: '10–30 triệu' },
      { contactName: '', phone: 'abc' },
      { contactName: 'C', phone: p },
      { contactName: 'D', phone: phone(), businessModel: 'Tiệm vàng', ownerEmail: 'nobody@x.vn', lastOrderAt: '31/02/2026' },
      { contactName: 'E', phone: phone(), orderCount: 2 },
    ]);
    const preview = await parseCustomerWorkbook(db, org.as(org.owner), buf);
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([3, 4, 5, 6]);
    expect(preview.errors[0]!.messages).toEqual(expect.arrayContaining(['Thiếu tên người liên hệ', 'Số điện thoại "abc" không hợp lệ']));
    expect(preview.errors[1]!.messages[0]).toMatch(/Trùng số điện thoại với dòng 2/);
    expect(preview.errors[2]!.messages).toHaveLength(3);
    expect(preview.errors[3]!.messages).toEqual(['Khách đã có đơn cần "Ngày đơn gần nhất"']);
    await expect(parseCustomerWorkbook(db, org.as(org.sales[0]!), buf)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('2.000 rows import in < 60 s, round-robin owners, buying customers keep history (AC 6.2)', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      contactName: `Khách ${i}`,
      phone: phone(),
      shopName: `Shop ${i}`,
      businessModel: i % 2 ? 'Minimart / siêu thị mini' : 'CAFE',
      province: 'Hà Nội',
      ...(i % 4 === 0 ? { lastOrderAt: '01/10/2026', orderCount: 3, totalRevenue: '12.500.000', reorderCycleDays: 30 } : {}),
    }));
    const preview = await parseCustomerWorkbook(db, org.as(org.owner), await workbook(rows));
    expect(preview.errors).toEqual([]);
    const progress: number[] = [];
    const t0 = Date.now();
    const result = await runCustomerImport(db, recordingEffects(), org.as(org.owner), preview.rows, { mode: 'auto' }, (done) => {
      progress.push(done);
    });
    const ms = Date.now() - t0;
    console.log(`import 2000 rows: ${ms} ms`);
    expect(ms).toBeLessThan(60_000);
    expect(result).toMatchObject({ created: 2000, updated: 0, leadsCreated: 1500, failed: [] });
    expect(progress.at(-1)).toBe(2000);

    const owners = await db.customer.groupBy({ by: ['ownerId'], where: { orgId: org.orgId, tags: { has: 'import' } }, _count: { _all: true } });
    expect(owners.map((o) => o._count._all).sort()).toEqual([666, 667, 667]);
    const buyer = await db.customer.findFirstOrThrow({ where: { orgId: org.orgId, contactName: 'Khách 0' } });
    expect(buyer).toMatchObject({ orderCount: 3, reorderCycleLocked: true });
    expect(Number(buyer.totalRevenue)).toBe(12_500_000);
    expect(buyer.nextReorderAt!.toISOString().slice(0, 10)).toBe('2026-10-31');
    // imported prospects carry no first-contact SLA and sales got one summary notification each
    expect(await db.lead.count({ where: { orgId: org.orgId, source: 'IMPORT', firstContactDeadline: { not: null } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: org.sales[0]!.id, type: 'lead.assigned' } })).toBe(0);
    expect(await db.notification.count({ where: { userId: org.sales[0]!.id, type: 'import.done' } })).toBe(1);

    // re-import → only fills blanks
    const again = await runCustomerImport(db, recordingEffects(), org.as(org.owner), preview.rows.slice(0, 10), { mode: 'none' });
    expect(again).toMatchObject({ created: 0, updated: 10 });
  });
});

describe('customers: edit & merge (SPEC 6.2 "Gộp")', () => {
  it('merges a Facebook-only profile into the phone profile', async () => {
    const org = await createTestOrg(db);
    const s = org.sales[0]!;
    const a = await intakeLead(db, recordingEffects(), org.as(s), { source: 'HOTLINE', contactName: 'Chị Hoa', phone: phone(), province: 'Hải Phòng' });
    const b = await intakeLead(db, recordingEffects(), org.as(s), { source: 'MANUAL', contactName: 'chi hoa', email: 'hoa@example.com', province: 'Hai Phong', shopName: 'Shop Hoa' });
    const sugg = await mergeSuggestions(db, s, a.customerId);
    expect(sugg.map((x) => x.id)).toEqual([b.customerId]);

    const merged = await mergeCustomers(db, org.as(s), a.customerId, b.customerId);
    expect(merged).toMatchObject({ email: 'hoa@example.com', shopName: 'Shop Hoa' });
    expect(await db.lead.count({ where: { customerId: a.customerId } })).toBe(2);
    expect((await db.customer.findUniqueOrThrow({ where: { id: b.customerId } })).deletedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { entityId: a.customerId, action: 'customer.merge' } })).toBe(1);
    // another sales cannot touch them
    await expect(mergeCustomers(db, org.as(org.sales[1]!), a.customerId, b.customerId)).rejects.toBeTruthy();
  });

  it('phone edits are normalized and must stay unique; cycle edit locks auto-recalc', async () => {
    const org = await createTestOrg(db);
    const p1 = phone();
    const a = await intakeLead(db, recordingEffects(), apiActor(org.orgId), { source: 'HOTLINE', contactName: 'A', phone: p1 });
    const b = await intakeLead(db, recordingEffects(), apiActor(org.orgId), { source: 'HOTLINE', contactName: 'B', phone: phone() });
    await expect(updateCustomer(db, org.as(org.owner), b.customerId, { phone: p1 })).rejects.toMatchObject({ code: 'DUPLICATE_PHONE' });
    const u = await updateCustomer(db, org.as(org.owner), a.customerId, { phone: '0912.000.111', reorderCycleDays: 45 });
    expect(u).toMatchObject({ phone: '+84912000111', reorderCycleDays: 45, reorderCycleLocked: true });
    await expect(updateCustomer(db, org.as(org.sales[0]!), a.customerId, { tier: 'DAI_LY' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('users (SPEC 6.1)', () => {
  it('create → temp password; manager resets a sales password; forced change', async () => {
    const org = await createTestOrg(db);
    const { user, tempPassword } = await createUser(db, org.as(org.owner), { email: 'New@Test.local', fullName: 'Sales mới', role: 'SALES', phone: '0912 777 888' });
    expect(user).toMatchObject({ email: 'new@test.local', phone: '+84912777888', mustChangePassword: true });
    await expect(createUser(db, org.as(org.manager), { email: 'x@test.local', fullName: 'X', role: 'SALES' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const { tempPassword: t2 } = await resetUserPassword(db, org.as(org.manager), user.id);
    expect(t2).not.toBe(tempPassword);
    await expect(resetUserPassword(db, org.as(org.manager), org.owner.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const self = { ...org.as({ id: user.id, orgId: org.orgId, role: 'SALES', status: 'AVAILABLE' }) };
    await expect(changeOwnPassword(db, self, 'sai', 'MatKhauMoi123')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    await changeOwnPassword(db, self, t2, 'MatKhauMoi123');
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword).toBe(false);
  });
});
