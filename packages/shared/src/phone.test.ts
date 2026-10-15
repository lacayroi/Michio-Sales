import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeVnPhone, toLocalVnPhone } from './phone';

describe('normalizeVnPhone', () => {
  it.each([
    ['0912345678', '+84912345678'],
    ['0912 345 678', '+84912345678'],
    ['0912.345.678', '+84912345678'],
    ['0912-345-678', '+84912345678'],
    ['84912345678', '+84912345678'],
    ['+84912345678', '+84912345678'],
    ['+84 912 345 678', '+84912345678'],
    ['+84 0912 345 678', '+84912345678'],
    ['0337850791', '+84337850791'],
    ['0868123456', '+84868123456'],
    ['0703123456', '+84703123456'],
    ['0523123456', '+84523123456'],
    ['0246.68.56.986', '+842466856986'],
    ['028 3823 4567', '+842838234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected);
  });

  it.each([
    [''],
    [null],
    [undefined],
    ['abc'],
    ['091234567'], // too short
    ['09123456789'], // too long
    ['0112345678'], // invalid prefix
    ['0612345678'], // invalid prefix
    ['+1 650 555 1234'], // foreign
    ['912345678'], // missing leading 0
    ['0912a345678'],
  ])('rejects %s', (input) => {
    expect(normalizeVnPhone(input)).toBeNull();
  });
});

describe('toLocalVnPhone / maskPhone', () => {
  it('converts to local', () => {
    expect(toLocalVnPhone('+84912345678')).toBe('0912345678');
  });
  it('masks', () => {
    expect(maskPhone('+84912345678')).toBe('0912***678');
    expect(maskPhone('0912345678')).toBe('0912***678');
    expect(maskPhone(null)).toBe('');
  });
});
