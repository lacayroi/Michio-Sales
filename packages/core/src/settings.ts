// Typed access to the `Setting` table (SPEC 7.1). Missing keys fall back to the SPEC defaults,
// so code never depends on the seed having run.
import { type BusinessCalendar, DEFAULT_PRIORITY_BY_BAND, holidayKey, type OrderBandCode, type PriorityCode, type WeeklyHours } from '@michio/shared';
import type { Prisma } from '@michio/db';
import type { Db, Tx } from './context';

export const SETTING_DEFAULTS = {
  'sla.businessHoursOnly': true as boolean,
  'assignment.outOfHoursMode': 'ASSIGN_NOW' as 'ASSIGN_NOW' | 'HOLD',
  'assignment.keepCustomerOwner': true as boolean,
  'assignment.preferPreviousOwner': true as boolean,
  'assignment.reclaimOnContactSlaBreach': false as boolean,
  'priority.byOrderBand': DEFAULT_PRIORITY_BY_BAND as Record<OrderBandCode, PriorityCode>,
  'quote.validDays': 7,
  'quote.maxExtraDiscountPct': 0,
  'quote.followUpBusinessDays': 2,
  'reorder.defaultCycleDays': 30,
  'reorder.remindBeforeDays': 3,
  'reorder.dormantDays': 90,
  'lead.staleDays': 5,
  'notify.dailyDigestTime': '08:00',
  'notify.zaloOutsideHours': false as boolean,
  'facebook.standardWindowHours': 24,
  'facebook.humanAgentWindowDays': 7,
  'facebook.useHumanAgentTag': false as boolean,
  'zaloCompany.mode': 'QUICK_CAPTURE' as 'QUICK_CAPTURE' | 'GATEWAY',
  'zaloCompany.minSecondsBetweenMessages': 3,
  'zaloCompany.maxMessagesPerDay': 300,
  'woo.syncIntervalHours': 6,
  'calendar.holidaysConfirmedYears': [] as number[],
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] };

export async function loadSettings(db: Db | Tx, orgId: string): Promise<Settings> {
  const rows = await db.setting.findMany({ where: { orgId } });
  const out = { ...SETTING_DEFAULTS } as Record<string, unknown>;
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out as Settings;
}

export async function saveSetting<K extends SettingKey>(db: Db | Tx, orgId: string, key: K, value: Settings[K]) {
  const json = value as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { orgId_key: { orgId, key } },
    create: { orgId, key, value: json },
    update: { value: json },
  });
}

const DEFAULT_WEEKLY: WeeklyHours[] = [1, 2, 3, 4, 5, 6].map((dow) => ({
  dow,
  ranges: [
    ['08:00', '12:00'],
    ['13:30', '17:30'],
  ],
}));

/** Working calendar + holidays + `sla.businessHoursOnly` for SLA maths. */
export async function loadCalendar(db: Db | Tx, orgId: string, settings?: Settings): Promise<BusinessCalendar> {
  const [cal, holidays, s] = await Promise.all([
    db.workingCalendar.findUnique({ where: { orgId } }),
    db.holiday.findMany({ where: { orgId }, select: { date: true } }),
    settings ?? loadSettings(db, orgId),
  ]);
  return {
    weekly: (cal?.weekly as unknown as WeeklyHours[] | undefined) ?? DEFAULT_WEEKLY,
    holidays: new Set(holidays.map((h) => holidayKey(h.date))),
    businessHoursOnly: s['sla.businessHoursOnly'],
  };
}
