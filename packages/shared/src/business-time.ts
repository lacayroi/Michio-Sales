// Business-time arithmetic for SLAs (SPEC 6.3.1): Sundays, holidays, lunch break and nights don't count.
// All calendar maths happens in Vietnam local time (UTC+7, no DST).

const OFFSET = 7 * 60 * 60 * 1000;
const DAY = 86_400_000;
const MINUTE = 60_000;
const MAX_DAYS_SCAN = 800;

export interface WeeklyHours {
  /** 0 = Sunday … 6 = Saturday */
  dow: number;
  /** [["08:00","12:00"],["13:30","17:30"]] */
  ranges: [string, string][];
}

export interface BusinessCalendar {
  weekly: WeeklyHours[];
  /** Holiday dates as "yyyy-MM-dd" (Vietnam calendar day). */
  holidays: ReadonlySet<string>;
  /** `sla.businessHoursOnly = false` turns every helper into plain wall-clock maths. */
  businessHoursOnly?: boolean;
}

const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * MINUTE;
};

/** "yyyy-MM-dd" of the Vietnam calendar day containing `date`. */
export function vnDateKey(date: Date): string {
  return new Date(date.getTime() + OFFSET).toISOString().slice(0, 10);
}

/** Holiday rows are stored as @db.Date (UTC midnight) → "yyyy-MM-dd". */
export function holidayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Working ranges of one local day as [start, end) in *local* epoch ms. */
function rangesOf(cal: BusinessCalendar, localDayStart: number): [number, number][] {
  const key = new Date(localDayStart).toISOString().slice(0, 10);
  if (cal.holidays.has(key)) return [];
  const dow = new Date(localDayStart).getUTCDay();
  const day = cal.weekly.find((w) => w.dow === dow);
  if (!day) return [];
  return day.ranges.map(([s, e]) => [localDayStart + hhmm(s), localDayStart + hhmm(e)] as [number, number]);
}

export function isBusinessDay(cal: BusinessCalendar, at: Date): boolean {
  const local = at.getTime() + OFFSET;
  return rangesOf(cal, Math.floor(local / DAY) * DAY).length > 0;
}

export function isBusinessTime(cal: BusinessCalendar, at: Date): boolean {
  if (cal.businessHoursOnly === false) return true;
  const local = at.getTime() + OFFSET;
  return rangesOf(cal, Math.floor(local / DAY) * DAY).some(([s, e]) => local >= s && local < e);
}

/**
 * `start` plus `minutes` of working time. A start outside working hours begins counting at the
 * next opening (lead at 20:00 Saturday + 10 min → 08:10 Monday).
 */
export function addBusinessMinutes(cal: BusinessCalendar, start: Date, minutes: number): Date {
  if (cal.businessHoursOnly === false) return new Date(start.getTime() + minutes * MINUTE);
  let remaining = Math.max(0, minutes) * MINUTE;
  let t = start.getTime() + OFFSET;
  let day = Math.floor(t / DAY) * DAY;
  for (let i = 0; i < MAX_DAYS_SCAN; i++, day += DAY, t = day) {
    for (const [s, e] of rangesOf(cal, day)) {
      if (e <= t) continue;
      const from = Math.max(s, t);
      if (remaining <= e - from) return new Date(from + remaining - OFFSET);
      remaining -= e - from;
      t = e;
    }
  }
  throw new Error('Working calendar has no working hours');
}

/** Next moment that is inside working hours (or `at` itself). */
export function nextBusinessStart(cal: BusinessCalendar, at: Date): Date {
  return addBusinessMinutes(cal, at, 0);
}

/** `start` plus N working days, keeping the time of day when possible (used for follow-up tasks). */
export function addBusinessDays(cal: BusinessCalendar, start: Date, days: number): Date {
  let local = start.getTime() + OFFSET;
  const timeOfDay = local % DAY;
  let day = Math.floor(local / DAY) * DAY;
  let left = days;
  for (let i = 0; left > 0 && i < MAX_DAYS_SCAN; i++) {
    day += DAY;
    if (rangesOf(cal, day).length) left--;
  }
  local = day + timeOfDay;
  return nextBusinessStart(cal, new Date(local - OFFSET));
}

/** Working minutes elapsed between two instants (FRT, SPEC 6.11). Negative spans return 0. */
export function businessMinutesBetween(cal: BusinessCalendar, from: Date, to: Date): number {
  if (to <= from) return 0;
  if (cal.businessHoursOnly === false) return (to.getTime() - from.getTime()) / MINUTE;
  const a = from.getTime() + OFFSET;
  const b = to.getTime() + OFFSET;
  let total = 0;
  for (let day = Math.floor(a / DAY) * DAY; day < b; day += DAY) {
    for (const [s, e] of rangesOf(cal, day)) {
      const lo = Math.max(s, a);
      const hi = Math.min(e, b);
      if (hi > lo) total += hi - lo;
    }
  }
  return total / MINUTE;
}
