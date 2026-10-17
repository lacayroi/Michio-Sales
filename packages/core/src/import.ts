// Excel import of existing wholesale customers (SPEC 6.2, Phụ lục A).
// Flow: parse + validate (preview, no writes) → confirm → background job runs `runCustomerImport`.
import { assertAuthorized } from '@michio/auth';
import type { Prisma } from '@michio/db';
import { fold, mapBusinessModel, mapCategory, mapOrderBand } from '@michio/integrations';
import { BUSINESS_MODEL_LABELS, normalizeVnPhone, ORDER_BAND_LABELS } from '@michio/shared';
import type ExcelJS from 'exceljs';
import { recordAudit } from './audit';
import type { ServiceContext } from './context';
import { computeLifecycle } from './customers';
import { DomainError } from './errors';
import { getSetting } from './settings';

const DAY = 86_400_000;

// Loaded on demand: only the import screens need it, and keeping it off the module graph keeps every
// other route (and the Next.js standalone trace) lighter.
const loadExcel = async () => (await import('exceljs')).default;

export const IMPORT_COLUMNS = [
  { key: 'contactName', header: 'Tên người liên hệ*', width: 24 },
  { key: 'phone', header: 'Số điện thoại*', width: 16 },
  { key: 'shopName', header: 'Tên shop/doanh nghiệp', width: 28 },
  { key: 'email', header: 'Email', width: 24 },
  { key: 'businessModel', header: 'Mô hình kinh doanh', width: 24 },
  { key: 'orderBand', header: 'Mức nhập dự kiến', width: 16 },
  { key: 'categories', header: 'Nhóm hàng quan tâm (cách nhau dấu phẩy)', width: 30 },
  { key: 'province', header: 'Tỉnh/Thành', width: 16 },
  { key: 'address', header: 'Địa chỉ giao hàng', width: 32 },
  { key: 'tier', header: 'Cấp khách', width: 12 },
  { key: 'ownerEmail', header: 'Sales phụ trách (email; trống = chia xoay vòng)', width: 30 },
  { key: 'lastOrderAt', header: 'Ngày đơn gần nhất (dd/mm/yyyy)', width: 18 },
  { key: 'orderCount', header: 'Số đơn đã mua', width: 12 },
  { key: 'totalRevenue', header: 'Tổng doanh số', width: 16 },
  { key: 'cycleDays', header: 'Chu kỳ đặt hàng (ngày)', width: 14 },
  { key: 'note', header: 'Ghi chú', width: 30 },
] as const;
type ColumnKey = (typeof IMPORT_COLUMNS)[number]['key'];

export const MAX_IMPORT_ROWS = 5000;

export interface ImportRowData {
  contactName: string;
  phone: string; // E.164
  shopName: string | null;
  email: string | null;
  businessModel: string | null;
  expectedOrderBand: string | null;
  interestCategories: string[];
  province: string | null;
  address: string | null;
  tier: string | null;
  ownerEmail: string | null;
  lastOrderAt: string | null; // ISO
  orderCount: number | null;
  totalRevenue: number | null;
  reorderCycleDays: number | null;
  note: string | null;
}

export interface ImportRow {
  rowNumber: number;
  data: ImportRowData | null;
  errors: string[];
  /** Filled by preview against the database. */
  action?: 'create' | 'update';
}

export type ImportOwnerMode = 'ROUND_ROBIN' | 'ONE_USER' | 'NONE';
export interface ImportOptions {
  ownerMode: ImportOwnerMode;
  userId?: string;
}

export async function buildImportTemplate(): Promise<Buffer> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Khach si');
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.addRow({
    contactName: 'Nguyễn Thị Hoa', phone: '0912 345 678', shopName: 'Shop Mẹ & Bé Hoa', email: 'hoa@example.com',
    businessModel: 'Shop online', orderBand: '10–30 triệu', categories: 'Matcha & Trà, Thực phẩm', province: 'Hải Phòng',
    address: 'Số 12 Lê Lợi, Ngô Quyền, Hải Phòng', tier: 'SI_1', ownerEmail: '', lastOrderAt: '05/10/2026', orderCount: 3,
    totalRevenue: 36500000, cycleDays: 30, note: 'Khách quen',
  });
  const guide = wb.addWorksheet('Huong dan');
  guide.addRows([
    ['Cột', 'Giá trị hợp lệ'],
    ['Mô hình kinh doanh', Object.values(BUSINESS_MODEL_LABELS).join(' | ')],
    ['Mức nhập dự kiến', Object.values(ORDER_BAND_LABELS).join(' | ')],
    ['Nhóm hàng quan tâm', 'Matcha & Trà, Thực phẩm, Đồ uống, Gia dụng, Khác'],
    ['Sales phụ trách', 'Email đăng nhập của sales; để trống thì theo tùy chọn khi nhập'],
  ]);
  guide.getColumn(1).width = 24;
  guide.getColumn(2).width = 100;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue); // formula
    return '';
  }
  return String(v).trim();
}

function parseDate(v: ExcelJS.CellValue): Date | null | 'invalid' {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v; // Excel date cell (UTC midnight)
  const m = cellText(v).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return 'invalid';
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d, 3)); // 10:00 ICT avoids day shifts
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : 'invalid';
}

export function parseNumber(v: ExcelJS.CellValue): number | null | 'invalid' {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = cellText(v).replace(/[.\s₫đ]/gi, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}

/** Parses and validates a workbook; never touches the database. */
export async function parseCustomerImport(buffer: ArrayBuffer | Buffer): Promise<ImportRow[]> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as ArrayBuffer);
  } catch {
    throw new DomainError('VALIDATION_ERROR', 'File không phải Excel (.xlsx) hợp lệ');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new DomainError('VALIDATION_ERROR', 'File không có trang tính nào');

  // Map columns by header text (folded), so column order and minor wording differences don't matter.
  const headerRow = ws.getRow(1);
  const colOf = new Map<ColumnKey, number>();
  headerRow.eachCell((cell, col) => {
    const h = fold(cellText(cell.value)).replace(/\*/g, '');
    const match = IMPORT_COLUMNS.find((c) => fold(c.header).replace(/\*/g, '') === h) ??
      IMPORT_COLUMNS.find((c) => h.startsWith(fold(c.header).replace(/\*/g, '').split(' (')[0] as string));
    if (match && !colOf.has(match.key)) colOf.set(match.key, col);
  });
  for (const required of ['contactName', 'phone'] as const) {
    if (!colOf.has(required)) {
      throw new DomainError('VALIDATION_ERROR', `Thiếu cột "${IMPORT_COLUMNS.find((c) => c.key === required)?.header}" — hãy dùng file mẫu`);
    }
  }
  if (ws.rowCount - 1 > MAX_IMPORT_ROWS) throw new DomainError('VALIDATION_ERROR', `Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập`);

  const rows: ImportRow[] = [];
  const seenPhones = new Map<string, number>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = (k: ColumnKey) => (colOf.has(k) ? row.getCell(colOf.get(k) as number).value : null);
    const txt = (k: ColumnKey) => cellText(raw(k)) || null;
    if (IMPORT_COLUMNS.every((c) => !txt(c.key))) return; // blank line
    const errors: string[] = [];

    const contactName = txt('contactName');
    if (!contactName) errors.push('Thiếu tên người liên hệ');
    const phoneRaw = txt('phone');
    const phone = phoneRaw ? normalizeVnPhone(phoneRaw) : null;
    if (!phoneRaw) errors.push('Thiếu số điện thoại');
    else if (!phone) errors.push(`SĐT "${phoneRaw}" không hợp lệ`);
    else if (seenPhones.has(phone)) errors.push(`SĐT trùng với dòng ${seenPhones.get(phone)}`);
    else seenPhones.set(phone, rowNumber);

    const email = txt('email');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Email "${email}" không hợp lệ`);

    const bmText = txt('businessModel');
    const businessModel = bmText ? mapBusinessModel(bmText, true) : null;
    if (bmText && !businessModel) errors.push(`Mô hình kinh doanh "${bmText}" không khớp`);
    const bandText = txt('orderBand');
    const expectedOrderBand = bandText ? mapOrderBand(bandText, true) : null;
    if (bandText && !expectedOrderBand) errors.push(`Mức nhập "${bandText}" không khớp`);

    const interestCategories: string[] = [];
    for (const c of (txt('categories') ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
      const code = mapCategory(c, true);
      if (code) interestCategories.push(code);
      else errors.push(`Nhóm hàng "${c}" không khớp`);
    }

    const last = parseDate(raw('lastOrderAt'));
    if (last === 'invalid') errors.push('Ngày đơn gần nhất phải dạng dd/mm/yyyy');
    const orderCount = parseNumber(raw('orderCount'));
    if (orderCount === 'invalid' || (typeof orderCount === 'number' && (orderCount < 0 || !Number.isInteger(orderCount)))) errors.push('Số đơn phải là số nguyên ≥ 0');
    const totalRevenue = parseNumber(raw('totalRevenue'));
    if (totalRevenue === 'invalid' || (typeof totalRevenue === 'number' && totalRevenue < 0)) errors.push('Tổng doanh số không hợp lệ');
    const cycle = parseNumber(raw('cycleDays'));
    if (cycle === 'invalid' || (typeof cycle === 'number' && (cycle < 7 || cycle > 120))) errors.push('Chu kỳ đặt hàng phải từ 7 đến 120 ngày');
    if (typeof orderCount === 'number' && orderCount > 0 && !(last instanceof Date)) errors.push('Có số đơn thì cần ngày đơn gần nhất');

    rows.push({
      rowNumber,
      errors,
      data: errors.length
        ? null
        : {
            contactName: contactName as string,
            phone: phone as string,
            shopName: txt('shopName'),
            email: email?.toLowerCase() ?? null,
            businessModel: businessModel ?? null,
            expectedOrderBand: expectedOrderBand ?? null,
            interestCategories: [...new Set(interestCategories)],
            province: txt('province'),
            address: txt('address'),
            tier: txt('tier')?.toUpperCase().replace(/\s+/g, '_') ?? null,
            ownerEmail: txt('ownerEmail')?.toLowerCase() ?? null,
            lastOrderAt: last instanceof Date ? last.toISOString() : null,
            orderCount: typeof orderCount === 'number' ? orderCount : null,
            totalRevenue: typeof totalRevenue === 'number' ? Math.round(totalRevenue) : null,
            reorderCycleDays: typeof cycle === 'number' ? Math.round(cycle) : null,
            note: txt('note'),
          },
    });
  });
  return rows;
}

/** Preview step: validation + checks that need the database (owner emails, existing phones). */
export async function previewCustomerImport(ctx: ServiceContext, buffer: ArrayBuffer | Buffer) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  assertAuthorized(ctx.actor, 'import.manage');
  const rows = await parseCustomerImport(buffer);
  const valid = rows.filter((r) => r.data);
  const emails = [...new Set(valid.map((r) => r.data?.ownerEmail).filter(Boolean) as string[])];
  const users = await ctx.db.user.findMany({ where: { orgId: ctx.orgId, email: { in: emails }, deletedAt: null, status: { not: 'INACTIVE' } }, select: { email: true } });
  const knownEmails = new Set(users.map((u) => u.email));
  const existing = await ctx.db.customer.findMany({ where: { orgId: ctx.orgId, deletedAt: null, phone: { in: valid.map((r) => r.data?.phone as string) } }, select: { phone: true } });
  const existingPhones = new Set(existing.map((c) => c.phone));
  for (const r of valid) {
    const d = r.data as ImportRowData;
    if (d.ownerEmail && !knownEmails.has(d.ownerEmail)) {
      r.errors.push(`Không có sales đang làm việc với email "${d.ownerEmail}"`);
      r.data = null;
      continue;
    }
    r.action = existingPhones.has(d.phone) ? 'update' : 'create';
  }
  return {
    rows,
    total: rows.length,
    valid: rows.filter((r) => r.data).length,
    invalid: rows.filter((r) => !r.data).length,
    creates: rows.filter((r) => r.action === 'create').length,
    updates: rows.filter((r) => r.action === 'update').length,
  };
}

export interface ImportSummary {
  created: number;
  updated: number;
  failed: { rowNumber: number; error: string }[];
}

const CHUNK = 200;

/** Background job body. Idempotent per phone: re-running updates instead of duplicating. */
export async function runCustomerImport(
  ctx: ServiceContext,
  rows: ImportRow[],
  options: ImportOptions,
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<ImportSummary> {
  const valid = rows.filter((r) => r.data) as (ImportRow & { data: ImportRowData })[];
  const now = ctx.now();
  const dormantDays = await getSetting(ctx.db, ctx.orgId, 'reorder.dormantDays');
  const defaultCycle = await getSetting(ctx.db, ctx.orgId, 'reorder.defaultCycleDays');

  const users = await ctx.db.user.findMany({ where: { orgId: ctx.orgId, deletedAt: null, status: { not: 'INACTIVE' } }, select: { id: true, email: true, role: true } });
  const userByEmail = new Map(users.map((u) => [u.email, u.id]));
  const priceLists = await ctx.db.priceList.findMany({ where: { orgId: ctx.orgId }, select: { id: true, tier: true, name: true } });
  const priceListFor = (tier: string | null) => (tier ? priceLists.find((p) => p.tier.toUpperCase() === tier || fold(p.name) === fold(tier))?.id ?? null : null);

  // Round-robin pool: the default rule's targets that can still work.
  let pool: string[] = [];
  if (options.ownerMode === 'ROUND_ROBIN') {
    const rule = await ctx.db.assignmentRule.findFirst({ where: { orgId: ctx.orgId, isActive: true }, orderBy: { priority: 'desc' } });
    const active = new Set(users.filter((u) => u.role === 'SALES').map((u) => u.id));
    pool = (rule?.targetUserIds ?? []).filter((id) => active.has(id));
    if (!pool.length) pool = [...active];
  }
  if (options.ownerMode === 'ONE_USER' && !users.some((u) => u.id === options.userId)) {
    throw new DomainError('VALIDATION_ERROR', 'Người nhận không hợp lệ');
  }
  let rr = 0;

  const summary: ImportSummary = { created: 0, updated: 0, failed: [] };
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const existing = await ctx.db.customer.findMany({ where: { orgId: ctx.orgId, deletedAt: null, phone: { in: chunk.map((r) => r.data.phone) } } });
    const byPhone = new Map(existing.map((c) => [c.phone, c]));
    const audits: Prisma.AuditLogCreateManyInput[] = [];
    const counts = { created: 0, updated: 0 };

    try {
    await ctx.db.$transaction(async (tx) => {
      for (const r of chunk) {
        const d = r.data;
        const current = byPhone.get(d.phone);
        let ownerId: string | null = d.ownerEmail ? (userByEmail.get(d.ownerEmail) ?? null) : (current?.ownerId ?? null);
        if (!ownerId && !d.ownerEmail) {
          if (options.ownerMode === 'ONE_USER') ownerId = options.userId ?? null;
          else if (options.ownerMode === 'ROUND_ROBIN' && pool.length) ownerId = pool[rr++ % pool.length] as string;
        }
        const orderCount = d.orderCount ?? current?.orderCount ?? 0;
        const lastOrderAt = d.lastOrderAt ? new Date(d.lastOrderAt) : (current?.lastOrderAt ?? null);
        const reorderCycleDays = d.reorderCycleDays ?? current?.reorderCycleDays ?? defaultCycle;
        const stats = {
          orderCount,
          lastOrderAt,
          firstOrderAt: current?.firstOrderAt ?? (orderCount === 1 ? lastOrderAt : null),
          totalRevenue: d.totalRevenue ?? current?.totalRevenue ?? 0,
          reorderCycleDays,
          reorderCycleLocked: d.reorderCycleDays != null ? true : (current?.reorderCycleLocked ?? false),
          nextReorderAt: lastOrderAt && orderCount > 0 ? new Date(lastOrderAt.getTime() + reorderCycleDays * DAY) : null,
          lifecycle: computeLifecycle({ orderCount, lastOrderAt, reorderCycleDays }, now, dormantDays),
        };
        const tier = d.tier ?? current?.tier ?? null;
        const profile = {
          shopName: d.shopName ?? current?.shopName ?? null,
          email: d.email ?? current?.email ?? null,
          businessModel: (d.businessModel ?? current?.businessModel ?? null) as never,
          expectedOrderBand: (d.expectedOrderBand ?? current?.expectedOrderBand ?? null) as never,
          interestCategories: [...new Set([...(current?.interestCategories ?? []), ...d.interestCategories])],
          province: d.province ?? current?.province ?? null,
          address: d.address ?? current?.address ?? null,
          tier,
          priceListId: priceListFor(tier) ?? current?.priceListId ?? null,
          note: d.note ? [current?.note, d.note].filter(Boolean).join('\n') : (current?.note ?? null),
        };
        if (current) {
          await tx.customer.update({ where: { id: current.id }, data: { ...profile, ...stats, ownerId } });
          audits.push({ orgId: ctx.orgId, actorId: ctx.actor?.id ?? null, via: ctx.via, action: 'customer.import_update', entityType: 'Customer', entityId: current.id, before: { ownerId: current.ownerId, orderCount: current.orderCount }, after: { ownerId, orderCount, row: r.rowNumber } });
          counts.updated++;
        } else {
          const c = await tx.customer.create({ data: { orgId: ctx.orgId, contactName: d.contactName, phone: d.phone, ...profile, ...stats, ownerId, tags: [] } });
          audits.push({ orgId: ctx.orgId, actorId: ctx.actor?.id ?? null, via: ctx.via, action: 'customer.import_create', entityType: 'Customer', entityId: c.id, after: { phone: c.phone, ownerId, row: r.rowNumber } });
          counts.created++;
        }
      }
      if (audits.length) await tx.auditLog.createMany({ data: audits });
    }, { maxWait: 30_000, timeout: 120_000 });
      summary.created += counts.created;
      summary.updated += counts.updated;
    } catch (err) {
      // A failed statement aborts the whole Postgres transaction, so the chunk is reported as failed together.
      const error = err instanceof Error ? err.message.split('\n').pop() ?? err.message : String(err);
      for (const r of chunk) summary.failed.push({ rowNumber: r.rowNumber, error });
    }
    await onProgress?.(Math.min(i + CHUNK, valid.length), valid.length);
  }
  await recordAudit(ctx.db, {
    orgId: ctx.orgId, actorId: ctx.actor?.id ?? null, via: ctx.via, action: 'customer.import', entityType: 'Import', entityId: '*',
    after: { created: summary.created, updated: summary.updated, failed: summary.failed.length, ownerMode: options.ownerMode },
  });
  return summary;
}
