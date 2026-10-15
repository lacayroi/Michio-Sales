import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatVnd } from './format';

describe('format', () => {
  it('formats VND', () => {
    expect(formatVnd(12500000)).toBe('12.500.000 ₫');
    expect(formatVnd('0')).toBe('0 ₫');
  });
  it('formats date in Vietnam time', () => {
    const d = new Date('2026-10-15T01:05:00Z'); // 08:05 ICT
    expect(formatDateTime(d)).toBe('15/10/2026 08:05');
    expect(formatDate(new Date('2026-10-15T18:00:00Z'))).toBe('16/10/2026');
  });
});
