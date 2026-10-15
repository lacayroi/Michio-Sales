import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, type BusinessCalendar, businessMinutesBetween, isBusinessTime } from './business-time';

// Michio default (SPEC A1): T2–T7 08:00–12:00, 13:30–17:30; Chủ nhật nghỉ.
const weekly = [1, 2, 3, 4, 5, 6].map((dow) => ({
  dow,
  ranges: [
    ['08:00', '12:00'],
    ['13:30', '17:30'],
  ] as [string, string][],
}));
const cal: BusinessCalendar = { weekly, holidays: new Set(['2026-09-01', '2026-09-02', '2026-11-24']) };

/** Vietnam local time → Date */
const vn = (s: string) => new Date(`${s}+07:00`);

describe('addBusinessMinutes (SPEC 6.3.4)', () => {
  it('AC 6.3: lead lúc 20:00 thứ Bảy có hạn nhận 08:10 thứ Hai', () => {
    // 17/10/2026 là thứ Bảy, 19/10/2026 là thứ Hai.
    expect(addBusinessMinutes(vn('2026-10-17T20:00:00'), 10, cal)).toEqual(vn('2026-10-19T08:10:00'));
  });

  it('within working hours', () => {
    expect(addBusinessMinutes(vn('2026-10-15T09:00:00'), 10, cal)).toEqual(vn('2026-10-15T09:10:00'));
  });

  it('across the lunch break', () => {
    expect(addBusinessMinutes(vn('2026-10-15T11:55:00'), 10, cal)).toEqual(vn('2026-10-15T13:35:00'));
  });

  it('lead arriving during lunch starts the clock at 13:30', () => {
    expect(addBusinessMinutes(vn('2026-10-15T12:30:00'), 5, cal)).toEqual(vn('2026-10-15T13:35:00'));
  });

  it('overnight', () => {
    expect(addBusinessMinutes(vn('2026-10-15T17:25:00'), 10, cal)).toEqual(vn('2026-10-16T08:05:00'));
    expect(addBusinessMinutes(vn('2026-10-15T06:00:00'), 10, cal)).toEqual(vn('2026-10-15T08:10:00'));
  });

  it('across Sunday (Saturday afternoon → Monday)', () => {
    expect(addBusinessMinutes(vn('2026-10-17T17:20:00'), 30, cal)).toEqual(vn('2026-10-19T08:20:00'));
    expect(addBusinessMinutes(vn('2026-10-18T10:00:00'), 10, cal)).toEqual(vn('2026-10-19T08:10:00'));
  });

  it('across holidays (Quốc khánh 1–2/9/2026)', () => {
    // 31/8/2026 thứ Hai 17:25 → nghỉ 1/9, 2/9 → 3/9 08:05
    expect(addBusinessMinutes(vn('2026-08-31T17:25:00'), 10, cal)).toEqual(vn('2026-09-03T08:05:00'));
  });

  it('AC 6.3 example is not shifted when Monday is a holiday', () => {
    // 21/11/2026 thứ Bảy 20:00; thứ Hai 23/11 bình thường; nếu Thứ Hai là lễ thì sang Thứ Ba.
    const withMondayHoliday: BusinessCalendar = { weekly, holidays: new Set(['2026-11-23']) };
    expect(addBusinessMinutes(vn('2026-11-21T20:00:00'), 10, withMondayHoliday)).toEqual(vn('2026-11-24T08:10:00'));
  });

  it('long durations spanning several days', () => {
    // 1 working day = 480 min. Thu 08:00 + 960 min = all of Thu + all of Fri → Fri 17:30
    expect(addBusinessMinutes(vn('2026-10-15T08:00:00'), 960, cal)).toEqual(vn('2026-10-16T17:30:00'));
    expect(addBusinessMinutes(vn('2026-10-15T08:00:00'), 961, cal)).toEqual(vn('2026-10-17T08:01:00'));
  });

  it('zero minutes returns the next working instant', () => {
    expect(addBusinessMinutes(vn('2026-10-18T09:00:00'), 0, cal)).toEqual(vn('2026-10-19T08:00:00'));
    expect(addBusinessMinutes(vn('2026-10-15T09:00:00'), 0, cal)).toEqual(vn('2026-10-15T09:00:00'));
  });

  it('rejects negative minutes and empty calendars', () => {
    expect(() => addBusinessMinutes(new Date(), -1, cal)).toThrow();
    expect(() => addBusinessMinutes(new Date(), 1, { weekly: [], holidays: new Set() })).toThrow();
  });
});

describe('isBusinessTime / businessMinutesBetween', () => {
  it('detects working time', () => {
    expect(isBusinessTime(vn('2026-10-15T09:00:00'), cal)).toBe(true);
    expect(isBusinessTime(vn('2026-10-15T12:30:00'), cal)).toBe(false);
    expect(isBusinessTime(vn('2026-10-18T09:00:00'), cal)).toBe(false); // Chủ nhật
    expect(isBusinessTime(vn('2026-11-24T09:00:00'), cal)).toBe(false); // 24/11
  });

  it('counts working minutes between instants', () => {
    expect(businessMinutesBetween(vn('2026-10-17T20:00:00'), vn('2026-10-19T08:10:00'), cal)).toBe(10);
    expect(businessMinutesBetween(vn('2026-10-15T11:50:00'), vn('2026-10-15T13:40:00'), cal)).toBe(20);
    expect(businessMinutesBetween(vn('2026-10-15T10:00:00'), vn('2026-10-15T09:00:00'), cal)).toBe(0);
  });
});
