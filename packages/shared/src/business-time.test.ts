import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addBusinessMinutes,
  type BusinessCalendar,
  businessMinutesBetween,
  isBusinessDay,
  isBusinessTime,
  nextBusinessStart,
  vnDateKey,
} from './business-time';

// T2–T7 08:00–12:00, 13:30–17:30 (SPEC A1); Sunday off.
const WEEKLY = [1, 2, 3, 4, 5, 6].map((dow) => ({
  dow,
  ranges: [
    ['08:00', '12:00'],
    ['13:30', '17:30'],
  ] as [string, string][],
}));
const cal: BusinessCalendar = { weekly: WEEKLY, holidays: new Set(['2026-04-27', '2026-04-30', '2026-05-01', '2026-09-01', '2026-09-02']) };

/** Vietnam local time → Date */
const vn = (s: string) => new Date(`${s}+07:00`);
const fmt = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

describe('addBusinessMinutes', () => {
  it.each([
    ['inside a range', '2026-10-15T09:00', 10, '2026-10-15 09:10'],
    ['across the lunch break', '2026-10-15T11:55', 10, '2026-10-15 13:35'],
    ['starting during lunch', '2026-10-15T12:30', 10, '2026-10-15 13:40'],
    ['across the night', '2026-10-15T17:25', 10, '2026-10-16 08:05'],
    ['before opening', '2026-10-15T06:00', 10, '2026-10-15 08:10'],
    ['ending exactly at closing', '2026-10-15T17:20', 10, '2026-10-15 17:30'],
    // SPEC 6.3 AC: lead at 20:00 Saturday → accept deadline 08:10 Monday.
    ['across Sunday (AC 6.3)', '2026-10-17T20:00', 10, '2026-10-19 08:10'],
    ['on Sunday', '2026-10-18T10:00', 5, '2026-10-19 08:05'],
    ['Saturday afternoon across Sunday', '2026-10-17T17:25', 10, '2026-10-19 08:05'],
    // Giỗ Tổ nghỉ bù Monday 27/4 → Saturday night skips Sun + Mon.
    ['across Sunday + a Monday holiday', '2026-04-25T20:00', 10, '2026-04-28 08:10'],
    ['across a two-day holiday (Quốc khánh)', '2026-08-31T17:00', 60, '2026-09-03 08:30'],
    ['across 30/4 + 1/5', '2026-04-29T17:00', 60, '2026-05-02 08:30'],
    ['a full working day (8h) ends at closing', '2026-10-15T08:00', 8 * 60, '2026-10-15 17:30'],
    ['multi-day', '2026-10-15T08:00', 17 * 60, '2026-10-17 09:00'],
    ['zero minutes inside hours', '2026-10-15T09:00', 0, '2026-10-15 09:00'],
    ['zero minutes off hours → next opening', '2026-10-18T09:00', 0, '2026-10-19 08:00'],
  ])('%s', (_name, start, minutes, expected) => {
    expect(fmt(addBusinessMinutes(cal, vn(start), minutes))).toBe(expected);
  });

  it('is plain wall clock when businessHoursOnly = false', () => {
    const d = addBusinessMinutes({ ...cal, businessHoursOnly: false }, vn('2026-10-17T20:00'), 10);
    expect(fmt(d)).toBe('2026-10-17 20:10');
  });

  it('throws on a calendar without working hours', () => {
    expect(() => addBusinessMinutes({ weekly: [], holidays: new Set() }, vn('2026-10-15T09:00'), 1)).toThrow();
  });
});

describe('calendar predicates', () => {
  it('isBusinessTime / isBusinessDay', () => {
    expect(isBusinessTime(cal, vn('2026-10-15T09:00'))).toBe(true);
    expect(isBusinessTime(cal, vn('2026-10-15T12:00'))).toBe(false);
    expect(isBusinessTime(cal, vn('2026-10-15T17:30'))).toBe(false);
    expect(isBusinessTime(cal, vn('2026-10-18T09:00'))).toBe(false);
    expect(isBusinessDay(cal, vn('2026-10-17T22:00'))).toBe(true);
    expect(isBusinessDay(cal, vn('2026-09-02T09:00'))).toBe(false);
  });

  it('nextBusinessStart', () => {
    expect(fmt(nextBusinessStart(cal, vn('2026-10-17T18:00')))).toBe('2026-10-19 08:00');
    expect(fmt(nextBusinessStart(cal, vn('2026-10-15T10:00')))).toBe('2026-10-15 10:00');
  });

  it('vnDateKey uses the Vietnam day', () => {
    expect(vnDateKey(new Date('2026-10-15T18:00:00Z'))).toBe('2026-10-16');
  });
});

describe('addBusinessDays', () => {
  it('skips Sunday and holidays, keeps time of day', () => {
    expect(fmt(addBusinessDays(cal, vn('2026-10-16T10:00'), 2))).toBe('2026-10-19 10:00'); // Fri → Sat, Mon
    expect(fmt(addBusinessDays(cal, vn('2026-04-29T09:00'), 1))).toBe('2026-05-02 09:00');
  });
  it('moves an off-hours result to the next opening', () => {
    expect(fmt(addBusinessDays(cal, vn('2026-10-15T20:00'), 1))).toBe('2026-10-17 08:00');
  });
});

describe('businessMinutesBetween', () => {
  it.each([
    ['same range', '2026-10-15T09:00', '2026-10-15T09:25', 25],
    ['across lunch', '2026-10-15T11:50', '2026-10-15T13:40', 20],
    ['Saturday night → Monday', '2026-10-17T20:00', '2026-10-19T08:15', 15],
    ['reverse order', '2026-10-15T10:00', '2026-10-15T09:00', 0],
  ])('%s', (_n, a, b, expected) => {
    expect(businessMinutesBetween(cal, vn(a), vn(b))).toBe(expected);
  });
  it('is inverse of addBusinessMinutes', () => {
    const start = vn('2026-10-15T16:00');
    const end = addBusinessMinutes(cal, start, 500);
    expect(businessMinutesBetween(cal, start, end)).toBe(500);
  });
});
