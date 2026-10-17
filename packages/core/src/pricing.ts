// Wholesale pricing (SPEC 6.6): one price list per customer tier; each line has a unit price, a
// minimum quantity and optional quantity breaks. Prices never come from the website (SPEC 5.6).
import { authorize } from '@michio/auth';
import type { PriceList, Prisma, PrismaClient } from '@michio/db';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { DomainError, notFound } from './errors';

export interface QtyBreak {
  minQty: number;
  price: number;
}

export interface PriceRule {
  price: number;
  minQty: number;
  qtyBreaks: QtyBreak[] | null;
}

/** Unit price for a quantity: the break with the highest `minQty` ≤ qty wins, else the base price. */
export function unitPriceFor(rule: PriceRule, qty: number): { unitPrice: number; belowMinQty: boolean; appliedBreak: number | null } {
  let unitPrice = rule.price;
  let appliedBreak: number | null = null;
  for (const b of [...(rule.qtyBreaks ?? [])].sort((a, z) => a.minQty - z.minQty)) {
    if (qty >= b.minQty) {
      unitPrice = b.price;
      appliedBreak = b.minQty;
    }
  }
  return { unitPrice, belowMinQty: qty < rule.minQty, appliedBreak };
}

export const parseQtyBreaks = (v: unknown): QtyBreak[] | null =>
  Array.isArray(v) ? v.filter((b): b is QtyBreak => typeof b?.minQty === 'number' && typeof b?.price === 'number') : null;

export interface QuoteLineInput {
  qty: number;
  unitPrice: number;
  discountPct: number;
}

/** Line and document totals in VND (integers). Discount % applies on top of the tier price. */
export function computeLine(l: QuoteLineInput) {
  const gross = Math.round(l.qty * l.unitPrice);
  const discount = Math.round((gross * l.discountPct) / 100);
  return { gross, discount, lineTotal: gross - discount };
}

export function computeTotals(lines: QuoteLineInput[], shippingFee = 0) {
  let subtotal = 0;
  let discount = 0;
  for (const l of lines) {
    const c = computeLine(l);
    subtotal += c.gross;
    discount += c.discount;
  }
  return { subtotal, discount, shippingFee, total: subtotal - discount + shippingFee };
}

type Db = PrismaClient | Prisma.TransactionClient;

const validAt = (pl: Pick<PriceList, 'validFrom' | 'validTo'>, at: Date) => (!pl.validFrom || pl.validFrom <= at) && (!pl.validTo || pl.validTo >= at);

/** The customer's list (explicit, else by tier), falling back to the base tier SI_1 / first list. */
export async function priceListFor(db: Db, orgId: string, customer: { priceListId: string | null; tier: string | null } | null, at: Date) {
  const lists = await db.priceList.findMany({ where: { orgId }, orderBy: { name: 'asc' } });
  const valid = lists.filter((l) => validAt(l, at));
  return (
    valid.find((l) => customer?.priceListId && l.id === customer.priceListId) ??
    valid.find((l) => customer?.tier && l.tier === customer.tier) ??
    valid.find((l) => l.tier === 'SI_1') ??
    valid[0] ??
    null
  );
}

export const ResolveInput = z.object({
  customerId: z.string().nullable().optional(),
  priceListId: z.string().optional(),
  items: z.array(z.object({ productId: z.string(), qty: z.coerce.number().int().min(1).max(1_000_000) })).min(1).max(200),
});

export type PriceSource = 'PRICE_LIST' | 'RETAIL' | 'NONE';

/** POST /pricing/resolve — price lines for a customer (scope-checked). */
export async function resolvePrices(ctx: ServiceContext, raw: z.input<typeof ResolveInput>) {
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const input = ResolveInput.parse(raw);
  const customer = input.customerId ? await ctx.db.customer.findFirst({ where: { id: input.customerId, orgId: ctx.orgId, deletedAt: null } }) : null;
  if (input.customerId && (!customer || !authorize(actor, 'customer.view', customer))) throw notFound('khách hàng');
  return priceLines(ctx.db, ctx.orgId, customer, input.items, ctx.now(), input.priceListId);
}

export async function priceLines(db: Db, orgId: string, customer: { priceListId: string | null; tier: string | null } | null, items: { productId: string; qty: number }[], at: Date, priceListId?: string) {
  const list = priceListId ? await db.priceList.findFirst({ where: { id: priceListId, orgId } }) : await priceListFor(db, orgId, customer, at);
  const ids = [...new Set(items.map((i) => i.productId))];
  const [products, rules] = await Promise.all([
    db.product.findMany({ where: { orgId, id: { in: ids } } }),
    list ? db.priceListItem.findMany({ where: { priceListId: list.id, productId: { in: ids } } }) : Promise.resolve([]),
  ]);
  const lines = items.map((i) => {
    const p = products.find((x) => x.id === i.productId);
    if (!p) throw new DomainError('VALIDATION_ERROR', 'Sản phẩm không tồn tại');
    const r = rules.find((x) => x.productId === p.id);
    let unitPrice = 0;
    let source: PriceSource = 'NONE';
    let belowMinQty = false;
    let minQty = 1;
    if (r) {
      const u = unitPriceFor({ price: Number(r.price), minQty: r.minQty, qtyBreaks: parseQtyBreaks(r.qtyBreaks) }, i.qty);
      unitPrice = u.unitPrice;
      belowMinQty = u.belowMinQty;
      minQty = r.minQty;
      source = 'PRICE_LIST';
    } else if (p.retailPrice) {
      // Not in the wholesale list yet: show the retail price, flagged, so sales can ask the Owner.
      unitPrice = Number(p.retailPrice);
      source = 'RETAIL';
    }
    return {
      productId: p.id, sku: p.sku, name: p.name, unit: p.unit, unitsPerCase: p.unitsPerCase, imageUrl: p.imageUrl, inStock: p.inStock,
      qty: i.qty, unitPrice, source, belowMinQty, minQty,
    };
  });
  return { priceList: list ? { id: list.id, name: list.name, tier: list.tier } : null, lines };
}
