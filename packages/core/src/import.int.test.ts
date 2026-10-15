import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { createTestOrg, testDb } from '../test/fixtures';
import { buildImportTemplate, IMPORT_COLUMNS, parseCustomerImport, previewCustomerImport, runCustomerImport } from './import';

async function workbook(rows: (string | number | Date | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Khach si');
  ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const row = (over: Partial<Record<(typeof IMPORT_COLUMNS)[number]['key'], string | number | Date | null>>) =>
  IMPORT_COLUMNS.map((c) => over[c.key] ?? null);

describe('Import Excel (SPEC 6.2, Phụ lục A)', () => {
  it('the template parses cleanly', async () => {
    const rows = await parseCustomerImport(await buildImportTemplate());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.data).toMatchObject({ phone: '+84912345678', businessModel: 'ONLINE_SHOP', expectedOrderBand: 'B10_30M', interestCategories: ['MATCHA_TEA', 'FOOD'] });
  });

  it('preview reports row errors without writing anything', async () => {
    const org = await createTestOrg();
    const buf = await workbook([
      row({ contactName: 'A', phone: '0912345678' }),
      row({ contactName: '', phone: 'abc' }),
      row({ contactName: 'B', phone: '0912 345 678' }), // duplicate in file
      row({ contactName: 'C', phone: '0983000111', businessModel: 'Bán xe', orderBand: 'rất nhiều', categories: 'Matcha, Ô tô' }),
      row({ contactName: 'D', phone: '0983000112', orderCount: 3 }), // count without date
      row({ contactName: 'E', phone: '0983000113', ownerEmail: 'khong-ton-tai@x.vn' }),
      row({ contactName: 'F', phone: '0983000114', lastOrderAt: '31/02/2026' }),
    ]);
    const p = await previewCustomerImport(org.ctx({ actor: org.owner }), buf);
    const errs = Object.fromEntries(p.rows.map((r) => [r.rowNumber, r.errors]));
    expect(p).toMatchObject({ total: 7, valid: 1, invalid: 6, creates: 1 });
    expect(errs[3]).toEqual(['Thiếu tên người liên hệ', 'SĐT "abc" không hợp lệ']);
    expect(errs[4]).toEqual(['SĐT trùng với dòng 2']);
    expect(errs[5]).toEqual(['Mô hình kinh doanh "Bán xe" không khớp', 'Mức nhập "rất nhiều" không khớp', 'Nhóm hàng "Ô tô" không khớp']);
    expect(errs[6]).toEqual(['Có số đơn thì cần ngày đơn gần nhất']);
    expect(errs[7]?.[0]).toContain('Không có sales đang làm việc');
    expect(errs[8]).toEqual(['Ngày đơn gần nhất phải dạng dd/mm/yyyy']);
    expect(await testDb().customer.count({ where: { orgId: org.orgId } })).toBe(0);
    await expect(previewCustomerImport(org.ctx({ actor: org.sales[0]! }), buf)).rejects.toThrow('quyền');
  });

  it('imports 2.000 rows in < 60 s, round-robin owners, lifecycle from history, idempotent', async () => {
    const org = await createTestOrg();
    const now = new Date('2026-10-15T02:00:00Z');
    const rows = Array.from({ length: 2000 }, (_, i) =>
      row({
        contactName: `Khách ${i}`,
        phone: `09${String(30_000_000 + i).padStart(8, '0')}`,
        shopName: `Shop ${i}`,
        businessModel: 'Minimart / siêu thị mini',
        province: 'Hà Nội',
        lastOrderAt: i % 4 === 0 ? null : i % 4 === 1 ? '05/10/2026' : i % 4 === 2 ? '01/08/2026' : '01/05/2026',
        orderCount: i % 4 === 0 ? null : i % 4 === 1 ? 3 : 2,
        totalRevenue: i % 4 === 0 ? null : 25_000_000,
        ownerEmail: i === 7 ? org.sales[2]!.email : null,
      }),
    );
    const buf = await workbook(rows);
    const ctx = org.ctx({ actor: org.owner, now });
    const started = Date.now();
    const preview = await previewCustomerImport(ctx, buf);
    expect(preview.valid).toBe(2000);
    const summary = await runCustomerImport(ctx, preview.rows, { ownerMode: 'ROUND_ROBIN' });
    const elapsed = Date.now() - started;
    expect(summary).toEqual({ created: 2000, updated: 0, failed: [] });
    expect(elapsed).toBeLessThan(60_000);

    const db = testDb();
    const owners = await db.customer.groupBy({ by: ['ownerId'], where: { orgId: org.orgId }, _count: true });
    for (const o of owners) expect(Math.abs(o._count - 2000 / 3)).toBeLessThanOrEqual(2);
    const lifecycles = await db.customer.groupBy({ by: ['lifecycle'], where: { orgId: org.orgId }, _count: true });
    expect(Object.fromEntries(lifecycles.map((l) => [l.lifecycle, l._count]))).toEqual({ PROSPECT: 500, REPEAT: 500, AT_RISK: 500, DORMANT: 500 });
    const explicit = await db.customer.findFirstOrThrow({ where: { orgId: org.orgId, contactName: 'Khách 7' } });
    expect(explicit.ownerId).toBe(org.sales[2]!.id);

    // Re-running updates instead of duplicating.
    const again = await runCustomerImport(ctx, preview.rows.slice(0, 10), { ownerMode: 'NONE' });
    expect(again).toEqual({ created: 0, updated: 10, failed: [] });
    expect(await db.customer.count({ where: { orgId: org.orgId } })).toBe(2000);
    expect(await db.auditLog.count({ where: { orgId: org.orgId, action: { startsWith: 'customer.import' } } })).toBe(2012);
  });
});
