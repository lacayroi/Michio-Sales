// Import existing wholesale customers from Excel (SPEC 6.2, Phụ lục A).
// Flow: parse + validate every row (preview) → confirm → background job (`import` queue) with progress.
import { assertAuthorized } from '@michio/auth';
import type { BusinessModel, Lifecycle, OrderBand, Prisma } from '@michio/db';
import {
  BUSINESS_MODEL_LABELS,
  foldVietnamese,
  normalizeVnPhone,
  ORDER_BAND_LABELS,
  parseBusinessModel,
  parseInterestCategories,
  parseOrderBand,
} from '@michio/shared';
import ExcelJS from 'exceljs';
import { recordAudit } from '../audit';
import { type Actor, type Db, TX_OPTIONS } from '../context';
import { EffectBuffer, type Effects } from '../effects';
import { ValidationError } from '../errors';
import { notifyUsers } from '../notifications';
import { loadSettings } from '../settings';

export const IMPORT_COLUMNS = [
  { key: 'contactName', header: 'Tên người liên hệ*', width: 24 },
  { key: 'phone', header: 'Số điện thoại*', width: 16 },
  { key: 'shopName', header: 'Tên shop/doanh nghiệp', width: 26 },
  { key: 'email', header: 'Email', width: 24 },
  { key: 'businessModel', header: 'Mô hình kinh doanh', width: 24 },
  { key: 'expectedOrderBand', header: 'Mức nhập dự kiến', width: 16 },
  { key: 'interestCategories', header: 'Nhóm hàng quan tâm (cách nhau dấu phẩy)', width: 30 },
  { key: 'province', header: 'Tỉnh/Thành', width: 16 },
  { key: 'address', header: 'Địa chỉ giao hàng', width: 30 },
  { key: 'tier', header: 'Cấp khách', width: 12 },
  { key: 'ownerEmail', header: 'Sales phụ trách (email; trống = chia xoay vòng)', width: 30 },
  { key: 'lastOrderAt', header: 'Ngày đơn gần nhất (dd/mm/yyyy)', width: 18 },
  { key: 'orderCount', header: 'Số đơn đã mua', width: 12 },
  { key: 'totalRevenue', header: 'Tổng doanh số', width: 16 },
  { key: 'reorderCycleDays', header: 'Chu kỳ đặt hàng (ngày)', width: 14 },
  { key: 'note', header: 'Ghi chú', width: 30 },
] as const;

type ColumnKey = (typeof IMPORT_COLUMNS)[number]['key'];

export const MAX_IMPORT_ROWS = 5000;

export interface ImportRow {
  rowNumber: number;
  contactName: string;
  phone: string;
  shopName: string | null;
  email: string | null;
  businessModel: BusinessModel | null;
  expectedOrderBand: OrderBand | null;
  interestCategories: string[];
  province: string | null;
  address: string | null;
  tier: string | null;
  ownerId: string | null;
  lastOrderAt: string | null; // ISO
  orderCount: number;
  totalRevenue: number;
  reorderCycleDays: number | null;
  note: string | null;
}

export interface RowError {
  rowNumber: number;
  messages: string[];
}

export interface ImportPreview {
  rows: ImportRow[];
  errors: RowError[];
  totalRows: number;
  /** Rows whose phone already exists — they will only fill blank fields. */
  existing: number;
}

export async function buildImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Khach si');
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.addRow({
    contactName: 'Nguyễn Thị Hoa',
    phone: '0912 345 678',
    shopName: 'Shop Mẹ & Bé Hoa',
    email: 'hoa@example.com',
    businessModel: 'Shop online',
    expectedOrderBand: '10–30 triệu',
    interestCategories: 'Matcha & Trà, Bánh kẹo',
    province: 'Hải Phòng',
    address: '12 Lạch Tray, Ngô Quyền, Hải Phòng',
    tier: 'SI_1',
    ownerEmail: '',
    lastOrderAt: '15/09/2026',
    orderCount: 3,
    totalRevenue: 36500000,
    reorderCycleDays: 30,
    note: '',
  });
  const help = wb.addWorksheet('Gia tri hop le');
  help.columns = [
    { header: 'Mô hình kinh doanh', key: 'bm', width: 34 },
    { header: 'Mức nhập dự kiến', key: 'band', width: 20 },
  ];
  help.getRow(1).font = { bold: true };
  const bms = Object.values(BUSINESS_MODEL_LABELS);
  const bands = Object.values(ORDER_BAND_LABELS);
  for (let i = 0; i < Math.max(bms.length, bands.length); i++) help.addRow({ bm: bms[i] ?? '', band: bands[i] ?? '' });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue); // formula
    return '';
  }
  return String(v).trim();
}

/** dd/mm/yyyy, d/m/yy, yyyy-mm-dd or an Excel date → ISO date at 09:00 Vietnam time. */
export function parseVnDate(raw: ExcelJS.CellValue): string | null | 'INVALID' {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 2)).toISOString();
  const s = cellText(raw);
  if (!s) return null;
  let d: number, m: number, y: number;
  const vn = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (vn) [d, m, y] = [Number(vn[1]), Number(vn[2]), Number(vn[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return 'INVALID';
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d, 2));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return 'INVALID';
  return date.toISOString();
}

function parseNumber(raw: ExcelJS.CellValue): number | null | 'INVALID' {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw;
  const s = cellText(raw).replace(/[₫đ\s]/gi, '').replace(/[.,](?=\d{3}(\D|$))/g, '');
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 'INVALID';
}

/** Map header cells to column keys, tolerant of accents/case/extra text. */
function headerMap(ws: ExcelJS.Worksheet): Map<ColumnKey, number> {
  const map = new Map<ColumnKey, number>();
  const header = ws.getRow(1);
  const folded = IMPORT_COLUMNS.map((c) => ({ key: c.key, f: foldVietnamese(c.header.replace(/\(.*\)|\*/g, '')) }));
  header.eachCell((cell, col) => {
    const f = foldVietnamese(cellText(cell.value).replace(/\(.*\)|\*/g, ''));
    const match = folded.find((c) => c.f === f) ?? folded.find((c) => f.startsWith(c.f) || c.f.startsWith(f));
    if (match && !map.has(match.key)) map.set(match.key, col);
  });
  return map;
}

/** Parse and validate a workbook. Never writes to the database. */
export async function parseCustomerWorkbook(db: Db, actor: Actor, buffer: ArrayBuffer | Buffer): Promise<ImportPreview> {
  assertAuthorized(actor.user!, 'import.manage');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as ArrayBuffer);
  } catch {
    throw new ValidationError('File không đọc được — hãy dùng file .xlsx theo mẫu');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ValidationError('File không có trang tính nào');
  const cols = headerMap(ws);
  for (const required of ['contactName', 'phone'] as const) {
    if (!cols.has(required)) throw new ValidationError(`Thiếu cột "${IMPORT_COLUMNS.find((c) => c.key === required)!.header}" — hãy dùng file mẫu`);
  }

  const [users, categories] = await Promise.all([
    db.user.findMany({ where: { orgId: actor.orgId, deletedAt: null }, select: { id: true, email: true, status: true } }),
    db.productCategory.findMany({ where: { orgId: actor.orgId }, select: { name: true, code: true, id: true } }),
  ]);
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const extraCategories = Object.fromEntries(categories.map((c) => [foldVietnamese(c.name), c.code ?? c.id]));

  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  const seenPhones = new Map<string, number>();
  let totalRows = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (k: ColumnKey) => (cols.has(k) ? row.getCell(cols.get(k)!).value : null);
    const text = (k: ColumnKey) => cellText(get(k)) || null;
    if (IMPORT_COLUMNS.every((c) => !text(c.key))) return; // blank line
    totalRows++;
    if (totalRows > MAX_IMPORT_ROWS) return;
    const msgs: string[] = [];

    const contactName = text('contactName');
    if (!contactName) msgs.push('Thiếu tên người liên hệ');
    const phoneRaw = text('phone');
    const phone = normalizeVnPhone(phoneRaw);
    if (!phoneRaw) msgs.push('Thiếu số điện thoại');
    else if (!phone) msgs.push(`Số điện thoại "${phoneRaw}" không hợp lệ`);
    else if (seenPhones.has(phone)) msgs.push(`Trùng số điện thoại với dòng ${seenPhones.get(phone)}`);
    else seenPhones.set(phone, rowNumber);

    const bmRaw = text('businessModel');
    const businessModel = parseBusinessModel(bmRaw);
    if (bmRaw && !businessModel) msgs.push(`Mô hình kinh doanh "${bmRaw}" không khớp danh sách`);
    const bandRaw = text('expectedOrderBand');
    const expectedOrderBand = parseOrderBand(bandRaw);
    if (bandRaw && !expectedOrderBand) msgs.push(`Mức nhập "${bandRaw}" không khớp danh sách`);

    const email = text('email')?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) msgs.push(`Email "${email}" không hợp lệ`);

    const ownerEmail = text('ownerEmail')?.toLowerCase() ?? null;
    let ownerId: string | null = null;
    if (ownerEmail) {
      const u = userByEmail.get(ownerEmail);
      if (!u) msgs.push(`Không có người dùng ${ownerEmail}`);
      else if (u.status === 'INACTIVE') msgs.push(`${ownerEmail} đã nghỉ việc`);
      else ownerId = u.id;
    }

    const lastOrderAt = parseVnDate(get('lastOrderAt'));
    if (lastOrderAt === 'INVALID') msgs.push('Ngày đơn gần nhất không đúng dạng dd/mm/yyyy');
    const orderCount = parseNumber(get('orderCount'));
    if (orderCount === 'INVALID' || (typeof orderCount === 'number' && (orderCount < 0 || !Number.isInteger(orderCount)))) msgs.push('Số đơn đã mua không hợp lệ');
    const totalRevenue = parseNumber(get('totalRevenue'));
    if (totalRevenue === 'INVALID' || (typeof totalRevenue === 'number' && totalRevenue < 0)) msgs.push('Tổng doanh số không hợp lệ');
    const cycle = parseNumber(get('reorderCycleDays'));
    if (cycle === 'INVALID' || (typeof cycle === 'number' && (cycle < 7 || cycle > 120))) msgs.push('Chu kỳ đặt hàng phải từ 7 đến 120 ngày');
    const count = typeof orderCount === 'number' ? orderCount : 0;
    if (count > 0 && !lastOrderAt) msgs.push('Khách đã có đơn cần "Ngày đơn gần nhất"');

    if (msgs.length) {
      errors.push({ rowNumber, messages: msgs });
      return;
    }
    rows.push({
      rowNumber,
      contactName: contactName!,
      phone: phone!,
      shopName: text('shopName'),
      email,
      businessModel: businessModel as BusinessModel | null,
      expectedOrderBand: expectedOrderBand as OrderBand | null,
      interestCategories: parseInterestCategories(text('interestCategories'), extraCategories),
      province: text('province'),
      address: text('address'),
      tier: text('tier'),
      ownerId,
      lastOrderAt: lastOrderAt as string | null,
      orderCount: count,
      totalRevenue: typeof totalRevenue === 'number' ? Math.round(totalRevenue) : 0,
      reorderCycleDays: typeof cycle === 'number' ? Math.round(cycle) : null,
      note: text('note'),
    });
  });
  if (totalRows > MAX_IMPORT_ROWS) throw new ValidationError(`File có ${totalRows} dòng, tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần`);
  if (!totalRows) throw new ValidationError('File không có dòng dữ liệu nào');

  const phones = rows.map((r) => r.phone);
  const existing = phones.length ? await db.customer.count({ where: { orgId: actor.orgId, deletedAt: null, phone: { in: phones } } }) : 0;
  return { rows, errors, totalRows, existing };
}

export type ImportAssign = { mode: 'auto' } | { mode: 'user'; userId: string } | { mode: 'none' };

export interface ImportResult {
  created: number;
  updated: number;
  leadsCreated: number;
  failed: { rowNumber: number; message: string }[];
}

function lifecycleFor(orderCount: number, lastOrderAt: Date, cycleDays: number, dormantDays: number, now: Date): Lifecycle {
  const days = (now.getTime() - lastOrderAt.getTime()) / 86_400_000;
  if (days > dormantDays) return 'DORMANT';
  if (days > 1.5 * cycleDays) return 'AT_RISK';
  return orderCount >= 2 ? 'REPEAT' : 'NEW_CUSTOMER';
}


const CHUNK = 250;

/**
 * Runs inside the `import` job. Rows are written in batches (AC 6.2: 2.000 dòng < 60 giây):
 * - phone already known → fill blank fields only;
 * - buying customers (orderCount > 0) → customer with order history + owner, no lead;
 * - prospects → customer + IMPORT lead, already accepted by its owner (or left unassigned).
 * Owners: the row's sales, else the chosen mode (auto = rotate over active sales).
 */
export async function runCustomerImport(
  db: Db,
  fx: Effects,
  actor: Actor,
  rows: ImportRow[],
  assign: ImportAssign,
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<ImportResult> {
  const orgId = actor.orgId;
  const actorId = actor.user?.id ?? null;
  const result: ImportResult = { created: 0, updated: 0, leadsCreated: 0, failed: [] };
  const settings = await loadSettings(db, orgId);
  const now = new Date();
  const salesPool =
    assign.mode === 'auto'
      ? (await db.user.findMany({ where: { orgId, role: 'SALES', deletedAt: null, status: { in: ['AVAILABLE', 'BUSY'] } }, orderBy: { createdAt: 'asc' }, select: { id: true } })).map((u) => u.id)
      : [];
  let rr = 0;
  const nextOwner = (row: ImportRow): string | null => {
    if (row.ownerId) return row.ownerId;
    if (assign.mode === 'user') return assign.userId;
    if (assign.mode === 'auto' && salesPool.length) return salesPool[rr++ % salesPool.length]!;
    return null;
  };
  const perOwner = new Map<string, number>();
  const cycleDefault = settings['reorder.defaultCycleDays'];
  const dormantDays = settings['reorder.dormantDays'];
  const priorityTable = settings['priority.byOrderBand'];

  let done = 0;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    try {
      await db.$transaction(async (tx) => {
        const existing = await tx.customer.findMany({ where: { orgId, deletedAt: null, phone: { in: chunk.map((r) => r.phone) } } });
        const byPhone = new Map(existing.map((c) => [c.phone!, c]));

        // 1) known phones: fill blanks
        for (const row of chunk.filter((r) => byPhone.has(r.phone))) {
          const c = byPhone.get(row.phone)!;
          const fill: Prisma.CustomerUpdateInput = {};
          if (!c.shopName && row.shopName) fill.shopName = row.shopName;
          if (!c.email && row.email) fill.email = row.email;
          if (!c.businessModel && row.businessModel) fill.businessModel = row.businessModel;
          if (!c.expectedOrderBand && row.expectedOrderBand) fill.expectedOrderBand = row.expectedOrderBand;
          if (!c.province && row.province) fill.province = row.province;
          if (!c.address && row.address) fill.address = row.address;
          if (!c.tier && row.tier) fill.tier = row.tier;
          const cats = [...new Set([...c.interestCategories, ...row.interestCategories])];
          if (cats.length !== c.interestCategories.length) fill.interestCategories = cats;
          if (Object.keys(fill).length) {
            await tx.customer.update({ where: { id: c.id }, data: fill });
            await recordAudit(tx, { orgId, actorId, via: actor.via, action: 'customer.import.update', entityType: 'Customer', entityId: c.id, after: fill as Prisma.InputJsonValue });
          }
        }

        // 2) new customers in one insert
        const fresh = chunk.filter((r) => !byPhone.has(r.phone)).map((row) => ({ row, ownerId: nextOwner(row) }));
        if (fresh.length) {
          const customers = await tx.customer.createManyAndReturn({
            data: fresh.map(({ row, ownerId }) => {
              const last = row.orderCount > 0 && row.lastOrderAt ? new Date(row.lastOrderAt) : null;
              const cycle = row.reorderCycleDays ?? cycleDefault;
              return {
                orgId,
                contactName: row.contactName,
                phone: row.phone,
                email: row.email,
                shopName: row.shopName,
                businessModel: row.businessModel,
                expectedOrderBand: row.expectedOrderBand,
                interestCategories: row.interestCategories,
                province: row.province,
                address: row.address,
                tier: row.tier,
                note: row.note,
                ownerId,
                tags: ['import'],
                reorderCycleDays: cycle,
                reorderCycleLocked: row.reorderCycleDays !== null,
                ...(last
                  ? {
                      orderCount: row.orderCount,
                      totalRevenue: row.totalRevenue,
                      lastOrderAt: last,
                      firstOrderAt: row.orderCount === 1 ? last : null,
                      nextReorderAt: new Date(last.getTime() + cycle * 86_400_000),
                      lifecycle: lifecycleFor(row.orderCount, last, cycle, dormantDays, now),
                    }
                  : {}),
              };
            }),
            select: { id: true, phone: true },
          });
          const customerId = new Map(customers.map((c) => [c.phone!, c.id]));

          // 3) IMPORT leads for prospects (already accepted by their owner: no accept SLA for a bulk import)
          const prospects = fresh.filter(({ row }) => !(row.orderCount > 0 && row.lastOrderAt));
          let leads: { id: string; customerId: string; ownerId: string | null }[] = [];
          if (prospects.length) {
            await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`lead-code:${orgId}`}))) AS l`;
            const max = await tx.lead.aggregate({ where: { orgId }, _max: { code: true } });
            let code = Math.max(1000, max._max.code ?? 1000);
            leads = await tx.lead.createManyAndReturn({
              data: prospects.map(({ row, ownerId }) => ({
                orgId,
                code: ++code,
                customerId: customerId.get(row.phone)!,
                source: 'IMPORT' as const,
                status: ownerId ? ('IN_PROGRESS' as const) : ('UNASSIGNED' as const),
                priority: priorityTable[row.expectedOrderBand ?? 'UNKNOWN'] ?? 'COLD',
                need: row.note,
                ownerId,
                firstAssignedAt: ownerId ? now : null,
                acceptedAt: ownerId ? now : null,
              })),
              select: { id: true, customerId: true, ownerId: true },
            });
            const assigned = leads.filter((l) => l.ownerId);
            if (assigned.length) {
              await tx.leadAssignment.createMany({
                data: assigned.map((l) => ({ leadId: l.id, userId: l.ownerId!, method: 'MANUAL' as const, status: 'ACCEPTED' as const, assignedById: actorId, respondedAt: now })),
              });
            }
          }

          const leadByCustomer = new Map(leads.map((l) => [l.customerId, l.id]));
          await tx.activity.createMany({
            data: fresh.map(({ row, ownerId }) => {
              const cid = customerId.get(row.phone)!;
              return { orgId, customerId: cid, leadId: leadByCustomer.get(cid) ?? null, userId: actorId, type: 'SYSTEM' as const, data: { kind: 'IMPORTED', rowNumber: row.rowNumber, ownerId } };
            }),
          });
          await tx.auditLog.createMany({
            data: [
              ...fresh.map(({ row, ownerId }) => ({
                orgId,
                actorId,
                via: actor.via,
                action: 'customer.import',
                entityType: 'Customer',
                entityId: customerId.get(row.phone)!,
                after: { phone: row.phone, ownerId, orderCount: row.orderCount, rowNumber: row.rowNumber },
              })),
              ...leads.map((l) => ({ orgId, actorId, via: actor.via, action: 'lead.create', entityType: 'Lead', entityId: l.id, after: { source: 'IMPORT', ownerId: l.ownerId } })),
            ],
          });
          result.leadsCreated += leads.length;
        }
        result.updated += chunk.length - fresh.length;
        result.created += fresh.length;
        for (const { ownerId } of fresh) if (ownerId) perOwner.set(ownerId, (perOwner.get(ownerId) ?? 0) + 1);
      }, TX_OPTIONS);
    } catch (err) {
      const message = err instanceof Error ? (err.message.split('\n').at(-1) ?? err.message) : String(err);
      for (const row of chunk) result.failed.push({ rowNumber: row.rowNumber, message });
    }
    done += chunk.length;
    await onProgress?.(done, rows.length);
  }

  const buf = new EffectBuffer();
  await db.$transaction(async (tx) => {
    for (const [userId, n] of perOwner) {
      await notifyUsers(tx, buf, orgId, [userId], { type: 'import.done', title: `📥 Bạn được giao ${n} khách từ file import`, body: 'Xem danh sách trong mục Khách hàng.', link: '/khach-hang' });
    }
    if (actorId) {
      await notifyUsers(tx, buf, orgId, [actorId], {
        type: 'import.done',
        title: '📥 Import khách sỉ đã xong',
        body: `Tạo mới ${result.created}, cập nhật ${result.updated}, lỗi ${result.failed.length}.`,
        link: '/khach-hang',
      });
    }
    await recordAudit(tx, {
      orgId,
      actorId,
      via: actor.via,
      action: 'import.customers',
      entityType: 'Import',
      entityId: '-',
      after: { created: result.created, updated: result.updated, leadsCreated: result.leadsCreated, failed: result.failed.length, assign: assign.mode },
    });
  });
  await buf.flush(fx);
  return result;
}
