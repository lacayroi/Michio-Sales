import { describe, expect, it } from 'vitest';
import { computeLine, computeTotals, unitPriceFor } from './pricing';

describe('unitPriceFor (tier price + quantity breaks)', () => {
  const rule = { price: 100_000, minQty: 6, qtyBreaks: [{ minQty: 48, price: 90_000 }, { minQty: 24, price: 95_000 }] };
  it.each([
    [1, 100_000, true, null],
    [6, 100_000, false, null],
    [23, 100_000, false, null],
    [24, 95_000, false, 24],
    [47, 95_000, false, 24],
    [48, 90_000, false, 48],
    [500, 90_000, false, 48],
  ])('qty %i → %i', (qty, price, below, applied) => {
    expect(unitPriceFor(rule, qty)).toEqual({ unitPrice: price, belowMinQty: below, appliedBreak: applied });
  });
  it('works without breaks', () => {
    expect(unitPriceFor({ price: 5000, minQty: 1, qtyBreaks: null }, 3).unitPrice).toBe(5000);
  });
});

describe('quote totals', () => {
  it('rounds per line in VND and sums discount + shipping', () => {
    expect(computeLine({ qty: 3, unitPrice: 33_333, discountPct: 2.5 })).toEqual({ gross: 99_999, discount: 2500, lineTotal: 97_499 });
    expect(computeTotals([{ qty: 12, unitPrice: 85_000, discountPct: 0 }, { qty: 3, unitPrice: 33_333, discountPct: 2.5 }], 30_000)).toEqual({
      subtotal: 1_119_999, discount: 2500, shippingFee: 30_000, total: 1_147_499,
    });
  });
});
