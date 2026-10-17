import { describe, expect, it } from 'vitest';
import { renderQuotePdf } from './index';

describe('renderQuotePdf', () => {
  it('renders a multi-page Vietnamese quote', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ no: i + 1, sku: `SKU-${i}`, name: `Bột matcha Uji số ${i + 1}`, unit: 'gói', unitsPerCase: 24, qty: 24, unitPrice: 100_000, discountPct: 0, lineTotal: 2_400_000 }));
    const pdf = await renderQuotePdf({
      code: 'BG-2026-000001', createdAt: new Date(), validUntil: new Date(), lines, subtotal: 48_000_000, discount: 0, shippingFee: 0, total: 48_000_000, terms: 'Giao hàng toàn quốc', priceListName: null,
      company: { legalName: 'Công ty Michio Việt Nam', address: 'Kim Giang, Hà Nội', hotline: '0246.68.56.986' },
      customer: { name: 'Shop Hoa', contactName: 'Chị Hoa', phone: '+84912345678', address: null, province: 'Hải Phòng', taxCode: null },
      sales: { name: 'Lê Thị Hạnh', phone: null, email: null },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toMatch(/\/Type \/Page\b[\s\S]*\/Type \/Page\b/); // ≥ 2 pages
    expect(pdf.toString('latin1')).toContain('BeVietnamPro');
  }, 30_000);
});
