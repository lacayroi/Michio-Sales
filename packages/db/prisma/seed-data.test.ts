import { describe, expect, it } from 'vitest';
import { holidaysFor } from './seed-data';

describe('holidaysFor (SPEC 6.1)', () => {
  const y2026 = holidaysFor(2026).map((h) => h.date);

  it('includes Ngày Văn hóa Việt Nam 24/11 from 2026', () => {
    expect(y2026).toContain('2026-11-24');
    expect(holidaysFor(2025).map((h) => h.date)).not.toContain('2025-11-24');
  });

  it('covers every statutory occasion in 2026 using the state-sector schedule', () => {
    for (const d of ['2026-01-01', '2026-02-16', '2026-02-21', '2026-04-26', '2026-04-27', '2026-04-30', '2026-05-01', '2026-09-01', '2026-09-02']) {
      expect(y2026).toContain(d);
    }
  });

  it('never lists Sundays (already non-working) or duplicates', () => {
    expect(new Set(y2026).size).toBe(y2026.length);
    expect(y2026.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0)).toEqual(['2026-04-26']); // Giỗ Tổ itself, kept for display
  });
});
