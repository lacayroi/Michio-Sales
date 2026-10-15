import { describe, expect, it } from 'vitest';
import { vnDayRange, vnMonthRange } from './time';

describe('vn time ranges', () => {
  it('day range follows ICT midnight', () => {
    const { start, end } = vnDayRange(new Date('2026-10-15T18:30:00Z')); // 01:30 on 16/10 ICT
    expect(start.toISOString()).toBe('2026-10-15T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-16T17:00:00.000Z');
  });
  it('month range and key', () => {
    const r = vnMonthRange(new Date('2026-10-31T20:00:00Z')); // 03:00 on 01/11 ICT
    expect(r.key).toBe('2026-11');
    expect(r.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
});
