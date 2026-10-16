import { describe, expect, it } from 'vitest';
import { foldVietnamese, parseBusinessModel, parseInterestCategories, parseOrderBand, priorityForBand } from './lead-codes';

describe('foldVietnamese', () => {
  it('strips diacritics and đ', () => {
    expect(foldVietnamese('Đại lý bán lẻ')).toBe('dai ly ban le');
    expect(foldVietnamese('  Minimart / siêu thị mini ')).toBe('minimart sieu thi mini');
  });
});

describe('parseBusinessModel', () => {
  it.each([
    ['ONLINE_SHOP', 'ONLINE_SHOP'],
    ['online_shop', 'ONLINE_SHOP'],
    ['Shop online', 'ONLINE_SHOP'],
    ['Cửa hàng hàng Nhật', 'JAPAN_STORE'],
    ['cua hang hang nhat', 'JAPAN_STORE'],
    ['Minimart / siêu thị mini', 'MINIMART'],
    ['Đại lý bán lẻ', 'RETAIL_AGENT'],
    ['Quán cafe / đồ uống', 'CAFE'],
    ['Doanh nghiệp / đối tác phân phối', 'DISTRIBUTOR'],
    ['Khác', 'OTHER'],
    ['', null],
    ['Tiệm vàng', null],
  ])('%s → %s', (input, expected) => expect(parseBusinessModel(input)).toBe(expected));
});

describe('parseOrderBand', () => {
  it.each([
    ['GT_50M', 'GT_50M'],
    ['10_30M', 'B10_30M'],
    ['B5_10M', 'B5_10M'],
    ['<5tr', 'LT_5M'],
    ['Dưới 5 triệu', 'LT_5M'],
    ['5–10 triệu', 'B5_10M'],
    ['10–30 triệu', 'B10_30M'],
    ['10-30tr', 'B10_30M'],
    ['30 - 50 triệu', 'B30_50M'],
    ['>50tr', 'GT_50M'],
    ['Trên 50 triệu', 'GT_50M'],
    ['Chưa rõ', 'UNKNOWN'],
    ['7-9 triệu', null],
    [undefined, null],
  ])('%s → %s', (input, expected) => expect(parseOrderBand(input)).toBe(expected));
});

describe('parseInterestCategories', () => {
  it('maps labels, codes and unknowns', () => {
    expect(parseInterestCategories(['Matcha & Trà', 'Thực phẩm', 'DRINK', 'Bánh kẹo'])).toEqual(['MATCHA_TEA', 'FOOD', 'DRINK', 'CANDY']);
    expect(parseInterestCategories('Gia dụng, Đồ uống ; Linh tinh')).toEqual(['HOUSEHOLD', 'DRINK', 'OTHER']);
    expect(parseInterestCategories(['Khăn giấy'], { 'khan giay': 'woo-55' })).toEqual(['woo-55']);
    expect(parseInterestCategories(['Đồ uống', 'do uong'])).toEqual(['DRINK']);
    expect(parseInterestCategories(null)).toEqual([]);
  });
});

describe('priorityForBand', () => {
  it('uses the default table (SPEC 5.1)', () => {
    expect(priorityForBand('GT_50M')).toBe('HOT');
    expect(priorityForBand('B30_50M')).toBe('HOT');
    expect(priorityForBand('B10_30M')).toBe('WARM');
    expect(priorityForBand('LT_5M')).toBe('COLD');
    expect(priorityForBand(null)).toBe('COLD');
  });
  it('honours a configured table', () => {
    expect(priorityForBand('B10_30M', { B10_30M: 'HOT' })).toBe('HOT');
  });
});
