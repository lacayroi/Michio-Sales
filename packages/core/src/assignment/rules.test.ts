import { describe, expect, it } from 'vitest';
import { matchesRule, type RoutableLead } from './rules';

const lead: RoutableLead = {
  source: 'WEBSITE_WHOLESALE_FORM',
  priority: 'HOT',
  businessModel: 'DISTRIBUTOR',
  expectedOrderBand: 'GT_50M',
  interestCategories: ['MATCHA_TEA', 'FOOD'],
  province: 'Hải Phòng',
  tags: ['vip'],
};
const at = new Date('2026-10-15T10:00:00+07:00');

describe('matchesRule', () => {
  it('empty conditions match everything (default rule)', () => {
    expect(matchesRule({}, lead, at)).toBe(true);
    expect(matchesRule(null, lead, at)).toBe(true);
  });

  it.each([
    [{ sources: ['WEBSITE_WHOLESALE_FORM', 'ZALO_COMPANY'] }, true],
    [{ sources: ['FACEBOOK_MESSENGER'] }, false],
    [{ businessModels: ['DISTRIBUTOR'] }, true],
    [{ orderBands: ['GT_50M', 'B30_50M'] }, true],
    [{ orderBands: ['LT_5M'] }, false],
    [{ interestCategories: ['DRINK', 'FOOD'] }, true],
    [{ interestCategories: ['DRINK'] }, false],
    [{ provinces: ['hai phong'] }, true], // accent-insensitive
    [{ provinces: ['Hà Nội'] }, false],
    [{ tags: ['vip'] }, true],
    [{ priorities: ['HOT'] }, true],
    [{ timeWindow: { from: '08:00', to: '12:00' } }, true],
    [{ timeWindow: { from: '13:30', to: '17:30' } }, false],
    [{ timeWindow: { from: '22:00', to: '11:00' } }, true], // wraps midnight
    // SPEC 6.3.2 example: DISTRIBUTOR hoặc GT_50M → needs both conditions here (AND)
    [{ businessModels: ['DISTRIBUTOR'], orderBands: ['LT_5M'] }, false],
  ])('%o → %s', (conditions, expected) => {
    expect(matchesRule(conditions, lead, at)).toBe(expected);
  });

  it('a lead without the attribute does not match a condition on it', () => {
    expect(matchesRule({ provinces: ['Hải Phòng'] }, { ...lead, province: null }, at)).toBe(false);
    expect(matchesRule({ businessModels: ['CAFE'] }, { ...lead, businessModel: null }, at)).toBe(false);
  });

  it('malformed conditions never capture leads', () => {
    expect(matchesRule({ sources: 'WEBSITE' }, lead, at)).toBe(false);
    expect(matchesRule({ unknownKey: 1 }, lead, at)).toBe(false);
  });
});
