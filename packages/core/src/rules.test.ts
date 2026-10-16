import { describe, expect, it } from 'vitest';
import { ruleMatches } from './rules';

const base = { source: 'WEBSITE_WHOLESALE_FORM', businessModel: 'CAFE', orderBand: 'GT_50M', interestCategories: ['MATCHA_TEA'], province: 'Hà Nội', tags: [], inBusinessHours: true };

describe('ruleMatches', () => {
  it('empty conditions match everything', () => {
    expect(ruleMatches({}, base)).toBe(true);
    expect(ruleMatches(null, base)).toBe(true);
  });
  it('matches each dimension', () => {
    expect(ruleMatches({ businessModels: ['DISTRIBUTOR'], orderBands: ['GT_50M'] }, base)).toBe(false);
    expect(ruleMatches({ orderBands: ['GT_50M', 'B30_50M'] }, base)).toBe(true);
    expect(ruleMatches({ interestCategories: ['FOOD', 'MATCHA_TEA'] }, base)).toBe(true);
    expect(ruleMatches({ interestCategories: ['FOOD'] }, base)).toBe(false);
    expect(ruleMatches({ provinces: ['hà nội '] }, base)).toBe(true);
    expect(ruleMatches({ sources: ['ZALO_COMPANY'] }, base)).toBe(false);
    expect(ruleMatches({ timeWindow: 'OUT_OF_HOURS' }, base)).toBe(false);
  });
  it('invalid conditions never match', () => {
    expect(ruleMatches({ unknownKey: 1 }, base)).toBe(false);
    expect(ruleMatches({ sources: ['NOPE'] }, base)).toBe(false);
  });
});
