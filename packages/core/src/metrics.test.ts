import { describe, expect, it } from 'vitest';
import { DEFAULT_WEEKLY } from './calendar';
import { conversion, frtMinutes, median, onTimeAcceptance, percentile, retention, revenue, vnQuarterRange } from './metrics';

const vn = (s: string) => new Date(`${s}+07:00`);
const cal = { weekly: DEFAULT_WEEKLY, holidays: new Set<string>() };

describe('median / percentile', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([], 90)).toBeNull();
  });
});

describe('FRT in working minutes', () => {
  it('skips lunch, nights and Sundays; ignores uncontacted leads', () => {
    expect(
      frtMinutes(
        [
          { firstAssignedAt: vn('2026-10-15T09:00:00'), firstContactAt: vn('2026-10-15T09:12:00') }, // 12
          { firstAssignedAt: vn('2026-10-15T11:50:00'), firstContactAt: vn('2026-10-15T13:40:00') }, // 10 + 10 = 20 (lunch)
          { firstAssignedAt: vn('2026-10-17T17:20:00'), firstContactAt: vn('2026-10-19T08:15:00') }, // Sat 10 + Mon 15 = 25
          { firstAssignedAt: vn('2026-10-15T09:00:00'), firstContactAt: null },
        ],
        cal,
      ),
    ).toEqual([12, 20, 25]);
  });
});

describe('on-time acceptance', () => {
  it('counts automatic assignments accepted before the deadline', () => {
    const d = vn('2026-10-15T09:10:00');
    expect(
      onTimeAcceptance([
        { method: 'ROUND_ROBIN', status: 'ACCEPTED', respondedAt: vn('2026-10-15T09:05:00'), acceptDeadline: d },
        { method: 'ROUND_ROBIN', status: 'ACCEPTED', respondedAt: vn('2026-10-15T09:11:00'), acceptDeadline: d },
        { method: 'ROUND_ROBIN', status: 'EXPIRED', respondedAt: null, acceptDeadline: d },
        { method: 'MANUAL', status: 'ACCEPTED', respondedAt: vn('2026-10-15T09:00:00'), acceptDeadline: null },
        { method: 'ROUND_ROBIN', status: 'PENDING', respondedAt: null, acceptDeadline: vn('2026-10-15T10:00:00') }, // still open
      ], vn('2026-10-15T09:30:00')),
    ).toEqual({ total: 3, onTime: 1, rate: 1 / 3 });
  });
});

describe('conversion, revenue, retention', () => {
  it('follows SPEC 6.11 definitions', () => {
    expect(conversion([{ isWon: true, isLost: false }, { isWon: false, isLost: true }, { isWon: true, isLost: false }])).toEqual({ won: 2, lost: 1, rate: 2 / 3 });
    expect(conversion([])).toEqual({ won: 0, lost: 0, rate: null });
    expect(revenue([{ total: 10, cancelled: false }, { total: 20, cancelled: false }, { total: 99, cancelled: true }])).toEqual({ revenue: 30, orders: 2, avgOrderValue: 15 });
    const q = vnQuarterRange(vn('2026-11-05T10:00:00'));
    expect(q.key).toBe('2026-Q4');
    expect(q.start).toEqual(vn('2026-10-01T00:00:00'));
    expect(
      retention(
        [
          { customerId: 'a', orderedAt: vn('2026-08-01T10:00:00') }, { customerId: 'a', orderedAt: vn('2026-10-10T10:00:00') },
          { customerId: 'b', orderedAt: vn('2026-09-01T10:00:00') },
          { customerId: 'c', orderedAt: vn('2026-10-02T10:00:00') }, // new this quarter: not in the base
        ],
        q,
      ),
    ).toEqual({ base: 2, returned: 1, rate: 0.5 });
  });
});
