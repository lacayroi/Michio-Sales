// Business-time arithmetic in Vietnam time (SPEC 6.3.1). ICT is UTC+7 all year (no DST).
// Pure functions: the calendar is passed in, so tests need no database.

const ICT_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

export interface WeeklyDay {
  dow: number; // 0 = Chủ nhật … 6 = Thứ Bảy
  ranges: [string, string][]; // [["08:00","12:00"],["13:30","17:30"]]
}

export interface BusinessCalendar {
  weekly: WeeklyDay[];
  /** Holiday dates as "yyyy-MM-dd" (Vietnam calendar day). */
  holidays: ReadonlySet<string>;
}

function hm(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
}

/** Midnight (as a UTC instant) of the Vietnam day containing `t`. */
function vnMidnight(t: number): number {
  return Math.floor((t + ICT_OFFSET_MS) / DAY_MS) * DAY_MS - ICT_OFFSET_MS;
}

export function vnDateKey(t: Date | number): string {
  return new Date(+t + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Working intervals [start, end) of the Vietnam day starting at `midnight`. */
function dayIntervals(midnight: number, cal: BusinessCalendar): [number, number][] {
  if (cal.holidays.has(vnDateKey(midnight))) return [];
  const dow = new Date(midnight + ICT_OFFSET_MS).getUTCDay();
  const day = cal.weekly.find((d) => d.dow === dow);
  if (!day) return [];
  return day.ranges
    .map(([s, e]) => [midnight + hm(s), midnight + hm(e)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

const MAX_DAYS_SCANNED = 400;

/**
 * Adds `minutes` of working time to `start`. Time outside working hours (nights, lunch break,
 * Sundays, holidays) is skipped. With `minutes = 0` it returns the next working instant.
 */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (minutes < 0) throw new Error('minutes must be >= 0');
  let remaining = minutes * 60_000;
  let cursor = start.getTime();
  let midnight = vnMidnight(cursor);
  for (let i = 0; i < MAX_DAYS_SCANNED; i++, midnight += DAY_MS) {
    for (const [s, e] of dayIntervals(midnight, cal)) {
      if (cursor >= e) continue;
      const from = Math.max(cursor, s);
      const available = e - from;
      if (remaining <= available) return new Date(from + remaining);
      remaining -= available;
      cursor = e;
    }
  }
  throw new Error('No working time found in the calendar');
}

export function isBusinessTime(t: Date, cal: BusinessCalendar): boolean {
  const ms = t.getTime();
  return dayIntervals(vnMidnight(ms), cal).some(([s, e]) => ms >= s && ms < e);
}

/** Working minutes between two instants (used for FRT, SPEC 6.11). */
export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  if (to <= from) return 0;
  let total = 0;
  const a = from.getTime();
  const b = to.getTime();
  for (let midnight = vnMidnight(a); midnight < b; midnight += DAY_MS) {
    for (const [s, e] of dayIntervals(midnight, cal)) {
      const lo = Math.max(s, a);
      const hi = Math.min(e, b);
      if (hi > lo) total += hi - lo;
    }
  }
  return Math.round(total / 60_000);
}
