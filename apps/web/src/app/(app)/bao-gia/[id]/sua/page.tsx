import { can } from '@michio/auth/permissions';
import { DomainError, getQuote, getSettings } from '@michio/core';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { QuoteBuilder } from '../../quote-builder';

export const metadata = { title: 'Sửa báo giá' };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('quote.manage');
  const { id } = await params;
  const ctx = serviceContext(user);
  const r = await getQuote(ctx, id).catch((err) => {
    if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  if (!r.can.edit) redirect(`/bao-gia/${id}`);
  const products = await ctx.db.product.findMany({ where: { id: { in: r.items.map((i) => i.productId) } }, select: { id: true, inStock: true } });
  const { 'quote.maxExtraDiscountPct': max } = await getSettings(ctx.db, ctx.orgId, ['quote.maxExtraDiscountPct']);
  const c = r.quote.customer;
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href={`/bao-gia/${id}`} className="text-sm text-muted-foreground hover:underline">← {r.quote.code}</Link>
        <h1 className="mt-1 text-2xl font-semibold">Sửa báo giá {r.quote.code}</h1>
      </div>
      <QuoteBuilder
        quoteId={id}
        customer={{ id: c.id, contactName: c.contactName, shopName: c.shopName, phone: c.phone, province: c.province }}
        initial={{
          lines: r.items.map((l) => ({ productId: l.productId, sku: l.sku, name: l.name, unit: l.unit, unitsPerCase: l.unitsPerCase, imageUrl: l.imageUrl, inStock: products.find((p) => p.id === l.productId)?.inStock ?? true, qty: l.qty, discountPct: l.discountPct })),
          shippingFee: Number(r.quote.shippingFee),
          terms: r.quote.terms,
        }}
        maxDiscountPct={max}
        canApprove={can(user.role, 'quote.approve')}
      />
    </section>
  );
}
