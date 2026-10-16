import { describe, expect, it } from 'vitest';
import { fold, isHoneypotTriggered, mapBusinessModel, mapCategory, mapOrderBand, PublicLeadPayload, toLeadIntake } from './wordpress-form';

describe('label mapping (SPEC 5.1)', () => {
  it('folds Vietnamese', () => {
    expect(fold('Đại lý  Bán lẻ')).toBe('dai ly ban le');
  });
  it.each([
    ['Cửa hàng hàng Nhật', 'JAPAN_STORE'],
    ['Shop online', 'ONLINE_SHOP'],
    ['Minimart / siêu thị mini', 'MINIMART'],
    ['Đại lý bán lẻ', 'RETAIL_AGENT'],
    ['Quán cafe / đồ uống', 'CAFE'],
    ['Doanh nghiệp / đối tác phân phối', 'DISTRIBUTOR'],
    ['Khác', 'OTHER'],
    ['ONLINE_SHOP', 'ONLINE_SHOP'],
    ['Tiệm tạp hóa', 'OTHER'],
  ])('business model %s → %s', (label, code) => expect(mapBusinessModel(label)).toBe(code));

  it.each([
    ['<5tr', 'LT_5M'],
    ['Dưới 5 triệu', 'LT_5M'],
    ['5–10 triệu', 'B5_10M'],
    ['10-30tr', 'B10_30M'],
    ['10–30 triệu', 'B10_30M'],
    ['30 - 50 triệu', 'B30_50M'],
    ['>50tr', 'GT_50M'],
    ['Trên 50 triệu', 'GT_50M'],
    ['5_10M', 'B5_10M'],
    ['B10_30M', 'B10_30M'],
    ['không rõ', 'UNKNOWN'],
  ])('order band %s → %s', (label, code) => expect(mapOrderBand(label)).toBe(code));

  it.each([
    ['Matcha & Trà', 'MATCHA_TEA'],
    ['Thực phẩm', 'FOOD'],
    ['Bánh kẹo', 'FOOD'],
    ['Đồ uống', 'DRINK'],
    ['Gia dụng', 'HOUSEHOLD'],
    ['Mỹ phẩm', 'OTHER'],
  ])('category %s → %s', (label, code) => expect(mapCategory(label)).toBe(code));
});

describe('PublicLeadPayload', () => {
  it('maps the Phụ lục B example', () => {
    const p = PublicLeadPayload.parse({
      formType: 'WHOLESALE', fullName: 'Nguyễn Thị Hoa', phone: '0912 345 678', shopName: 'Shop Mẹ & Bé Hoa', email: 'hoa@example.com',
      province: 'Hải Phòng', businessModel: 'Shop online', expectedOrderBand: '10–30 triệu', interestCategories: ['Matcha & Trà', 'Thực phẩm'],
      note: 'Muốn lấy matcha latte', pageUrl: 'https://michiovietnam.com/si-hang-nhat/', utm: { source: 'facebook', medium: 'cpc', campaign: 'si-thang11' }, website: '',
    });
    const lead = toLeadIntake(p);
    expect(lead).toMatchObject({
      source: 'WEBSITE_WHOLESALE_FORM', businessModel: 'ONLINE_SHOP', expectedOrderBand: 'B10_30M',
      interestCategories: ['MATCHA_TEA', 'FOOD'], campaign: 'si-thang11', need: 'Muốn lấy matcha latte',
    });
    expect(isHoneypotTriggered(p)).toBe(false);
  });
  it('accepts comma/newline separated categories and agent form', () => {
    const p = PublicLeadPayload.parse({ formType: 'AGENT', fullName: 'A', phone: '0912345678', interestCategories: 'Đồ uống\nGia dụng' });
    expect(toLeadIntake(p)).toMatchObject({ source: 'WEBSITE_AGENT_FORM', interestCategories: ['DRINK', 'HOUSEHOLD'] });
  });
  it('drops an invalid email instead of rejecting the lead', () => {
    const p = PublicLeadPayload.parse({ fullName: 'A', phone: '0912345678', email: 'not-an-email' });
    expect(toLeadIntake(p).email).toBeUndefined();
  });
  it('flags the honeypot', () => {
    expect(isHoneypotTriggered({ website: 'http://spam' })).toBe(true);
  });
});
