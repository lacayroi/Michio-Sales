// Company configuration (SPEC 6.12 Cài đặt): working hours, holidays, website API keys, settings.
import { createHash, randomBytes } from 'node:crypto';
import { assertAuthorized } from '@michio/auth';
import type { LeadSource, Prisma } from '@michio/db';
import type { WeeklyHours } from '@michio/shared';
import { z } from 'zod';
import { recordAudit } from '../audit';
import type { Actor, Db } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { loadSettings, saveSetting, SETTING_DEFAULTS, type SettingKey, type Settings } from '../settings';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WeeklySchema = z
  .array(
    z.object({
      dow: z.number().int().min(0).max(6),
      ranges: z.array(z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)])).max(4),
    }),
  )
  .max(7);

export async function getWorkingCalendar(db: Db, orgId: string): Promise<WeeklyHours[]> {
  const cal = await db.workingCalendar.findUnique({ where: { orgId } });
  return (cal?.weekly as unknown as WeeklyHours[] | undefined) ?? [];
}

export async function setWorkingCalendar(db: Db, actor: Actor, weekly: WeeklyHours[]) {
  assertAuthorized(actor.user!, 'settings.manage');
  const parsed = WeeklySchema.safeParse(weekly);
  if (!parsed.success) throw new ValidationError('Giờ làm việc không hợp lệ', parsed.error.issues);
  for (const d of parsed.data) {
    let prev = '';
    for (const [s, e] of d.ranges) {
      if (s >= e || s < prev) throw new ValidationError('Khung giờ phải tăng dần và không chồng nhau');
      prev = e;
    }
  }
  if (!parsed.data.some((d) => d.ranges.length)) throw new ValidationError('Cần ít nhất một ngày làm việc');
  const before = await getWorkingCalendar(db, actor.orgId);
  const value = parsed.data.filter((d) => d.ranges.length).sort((a, b) => a.dow - b.dow) as unknown as Prisma.InputJsonValue;
  await db.$transaction([
    db.workingCalendar.upsert({ where: { orgId: actor.orgId }, create: { orgId: actor.orgId, weekly: value }, update: { weekly: value } }),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'settings.calendar', entityType: 'WorkingCalendar', entityId: actor.orgId, before: before as unknown as Prisma.InputJsonValue, after: value, ip: actor.ip }),
  ]);
}

// ---------------------------------------------------------------- holidays

export async function listHolidays(db: Db, orgId: string, year?: number) {
  return db.holiday.findMany({
    where: { orgId, ...(year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}) },
    orderBy: { date: 'asc' },
  });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function addHoliday(db: Db, actor: Actor, input: { date: string; name: string }) {
  assertAuthorized(actor.user!, 'settings.manage');
  if (!DATE.test(input.date) || Number.isNaN(Date.parse(input.date))) throw new ValidationError('Ngày không hợp lệ');
  if (!input.name.trim()) throw new ValidationError('Cần tên ngày lễ');
  const date = new Date(`${input.date}T00:00:00Z`);
  const exists = await db.holiday.findUnique({ where: { orgId_date: { orgId: actor.orgId, date } } });
  if (exists) throw new ConflictError('HOLIDAY_EXISTS', 'Ngày này đã có trong lịch nghỉ');
  return db.$transaction(async (tx) => {
    const h = await tx.holiday.create({ data: { orgId: actor.orgId, date, name: input.name.trim() } });
    await recordAudit(tx, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'holiday.add', entityType: 'Holiday', entityId: h.id, after: { date: input.date, name: h.name }, ip: actor.ip });
    return h;
  });
}

export async function removeHoliday(db: Db, actor: Actor, id: string) {
  assertAuthorized(actor.user!, 'settings.manage');
  const h = await db.holiday.findFirst({ where: { id, orgId: actor.orgId } });
  if (!h) throw new NotFoundError('Không tìm thấy ngày lễ');
  await db.$transaction([
    db.holiday.delete({ where: { id } }),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'holiday.remove', entityType: 'Holiday', entityId: id, before: { date: h.date.toISOString().slice(0, 10), name: h.name }, ip: actor.ip }),
  ]);
}

/** Owner confirms the year's holiday schedule (SPEC 6.1 nhắc xác nhận lại). */
export async function confirmHolidayYear(db: Db, actor: Actor, year: number) {
  assertAuthorized(actor.user!, 'settings.manage');
  const s = await loadSettings(db, actor.orgId);
  const years = [...new Set([...s['calendar.holidaysConfirmedYears'], year])].sort();
  await db.$transaction(async (tx) => {
    await saveSetting(tx, actor.orgId, 'calendar.holidaysConfirmedYears', years);
    await recordAudit(tx, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'holiday.confirmYear', entityType: 'Setting', entityId: 'calendar.holidaysConfirmedYears', after: { year }, ip: actor.ip });
  });
  return years;
}

export async function holidayYearNeedsConfirmation(db: Db, orgId: string, year = new Date().getFullYear()) {
  const s = await loadSettings(db, orgId);
  return !s['calendar.holidaysConfirmedYears'].includes(year);
}

// ---------------------------------------------------------------- settings

/** Keys editable from the UI, with validators. Integration secrets live elsewhere. */
const EDITABLE: Partial<Record<SettingKey, z.ZodType>> = {
  'sla.businessHoursOnly': z.boolean(),
  'assignment.outOfHoursMode': z.enum(['ASSIGN_NOW', 'HOLD']),
  'assignment.keepCustomerOwner': z.boolean(),
  'assignment.preferPreviousOwner': z.boolean(),
  'assignment.reclaimOnContactSlaBreach': z.boolean(),
  'priority.byOrderBand': z.record(z.enum(['LT_5M', 'B5_10M', 'B10_30M', 'B30_50M', 'GT_50M', 'UNKNOWN']), z.enum(['HOT', 'WARM', 'COLD'])),
  'quote.validDays': z.number().int().min(1).max(90),
  'quote.maxExtraDiscountPct': z.number().min(0).max(100),
  'quote.followUpBusinessDays': z.number().int().min(1).max(30),
  'reorder.defaultCycleDays': z.number().int().min(7).max(120),
  'reorder.remindBeforeDays': z.number().int().min(0).max(30),
  'reorder.dormantDays': z.number().int().min(30).max(365),
  'lead.staleDays': z.number().int().min(1).max(60),
  'notify.dailyDigestTime': z.string().regex(HHMM),
  'notify.zaloOutsideHours': z.boolean(),
};

export function isEditableSetting(key: string): key is SettingKey {
  return key in EDITABLE;
}

export async function getSetting(db: Db, actor: Actor, key: string) {
  assertAuthorized(actor.user!, 'settings.manage');
  if (!(key in SETTING_DEFAULTS)) throw new NotFoundError('Không có cài đặt này');
  const s = await loadSettings(db, actor.orgId);
  return s[key as SettingKey];
}

export async function putSetting(db: Db, actor: Actor, key: string, value: unknown) {
  assertAuthorized(actor.user!, 'settings.manage');
  const schema = EDITABLE[key as SettingKey];
  if (!schema) throw new NotFoundError('Không sửa được cài đặt này');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError('Giá trị không hợp lệ', parsed.error.issues);
  const before = (await loadSettings(db, actor.orgId))[key as SettingKey];
  await db.$transaction(async (tx) => {
    await saveSetting(tx, actor.orgId, key as SettingKey, parsed.data as Settings[SettingKey]);
    await recordAudit(tx, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'settings.update', entityType: 'Setting', entityId: key, before: before as Prisma.InputJsonValue, after: parsed.data as Prisma.InputJsonValue, ip: actor.ip });
  });
  return parsed.data;
}

// ---------------------------------------------------------------- API keys (website form, SPEC Phụ lục B)

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

export async function listApiKeys(db: Db, actor: Actor) {
  assertAuthorized(actor.user!, 'integration.manage');
  return db.apiKey.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    select: { id: true, name: true, source: true, lastUsedAt: true, revokedAt: true },
  });
}

/** Returns the plaintext key exactly once; only its SHA-256 is stored. */
export async function createApiKey(db: Db, actor: Actor, input: { name: string; source: LeadSource }) {
  assertAuthorized(actor.user!, 'integration.manage');
  if (!input.name.trim()) throw new ValidationError('Cần tên API key');
  const key = `mk_live_${randomBytes(24).toString('base64url')}`;
  const row = await db.$transaction(async (tx) => {
    const k = await tx.apiKey.create({ data: { orgId: actor.orgId, name: input.name.trim(), source: input.source, hash: hashApiKey(key) } });
    await recordAudit(tx, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'apiKey.create', entityType: 'ApiKey', entityId: k.id, after: { name: k.name, source: k.source }, ip: actor.ip });
    return k;
  });
  return { id: row.id, name: row.name, source: row.source, key };
}

export async function revokeApiKey(db: Db, actor: Actor, id: string) {
  assertAuthorized(actor.user!, 'integration.manage');
  const k = await db.apiKey.findFirst({ where: { id, orgId: actor.orgId } });
  if (!k) throw new NotFoundError('Không tìm thấy API key');
  await db.$transaction([
    db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } }),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'apiKey.revoke', entityType: 'ApiKey', entityId: id, ip: actor.ip }),
  ]);
}

/** Resolve an `X-Api-Key` header. Revoked/unknown keys → null. */
export async function verifyApiKey(db: Db, key: string | null | undefined) {
  if (!key || key.length < 16 || key.length > 200) return null;
  const row = await db.apiKey.findUnique({ where: { hash: hashApiKey(key) } });
  if (!row || row.revokedAt) return null;
  // Best-effort usage stamp; not worth failing the request for.
  void db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return row;
}

// ---------------------------------------------------------------- company profile (PDF header, SPEC 6.12)

export interface CompanyProfile {
  legalName?: string;
  address?: string;
  hotline?: string;
  zaloPhone?: string;
  website?: string;
  facebookPage?: string;
  taxCode?: string | null;
  logoUrl?: string;
}

export async function getCompanyProfile(db: Db, orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  return { name: org.name, profile: (org.profile ?? {}) as CompanyProfile };
}

export async function updateCompanyProfile(db: Db, actor: Actor, input: { name?: string; profile: CompanyProfile }) {
  assertAuthorized(actor.user!, 'settings.manage');
  const before = await getCompanyProfile(db, actor.orgId);
  const profile = { ...before.profile, ...input.profile } as Prisma.InputJsonValue;
  await db.$transaction([
    db.organization.update({ where: { id: actor.orgId }, data: { ...(input.name?.trim() ? { name: input.name.trim() } : {}), profile } }),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'settings.company', entityType: 'Organization', entityId: actor.orgId, before: before as unknown as Prisma.InputJsonValue, after: { name: input.name ?? before.name, profile }, ip: actor.ip }),
  ]);
}
