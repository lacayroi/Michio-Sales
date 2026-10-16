import type { Prisma, PrismaClient } from '@michio/db';
import type { BusinessCalendar, WeeklyDay } from './business-time';

type Db = Pick<PrismaClient, 'workingCalendar' | 'holiday'> | Prisma.TransactionClient;

// SPEC A1 default, used when the org has no WorkingCalendar row.
export const DEFAULT_WEEKLY: WeeklyDay[] = [1, 2, 3, 4, 5, 6].map((dow) => ({
  dow,
  ranges: [
    ['08:00', '12:00'],
    ['13:30', '17:30'],
  ],
}));

export async function loadCalendar(db: Db, orgId: string): Promise<BusinessCalendar> {
  const [cal, holidays] = await Promise.all([
    db.workingCalendar.findUnique({ where: { orgId } }),
    db.holiday.findMany({ where: { orgId }, select: { date: true } }),
  ]);
  return {
    weekly: (cal?.weekly as WeeklyDay[] | undefined) ?? DEFAULT_WEEKLY,
    holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
  };
}
