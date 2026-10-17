import { DomainError, getPriceListItems, parseQtyBreaks } from '@michio/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { PriceListEditor } from './editor';

export const metadata = { title: 'Bảng giá sỉ' };

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('priceList.manage');
  const { id } = await params;
  const { list, items } = await getPriceListItems(serviceContext(user), id).catch((err) => {
    if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/san-pham?tab=bang-gia" className="text-sm text-muted-foreground hover:underline">← Bảng giá sỉ</Link>
        <h1 className="mt-1 text-2xl font-semibold">{list.name}</h1>
        <p className="text-sm text-muted-foreground">Áp dụng cho khách cấp <strong>{list.tier}</strong> (hoặc khách được gán riêng). {items.length} mã hàng.</p>
      </div>
      <PriceListEditor
        list={{ id: list.id, name: list.name, tier: list.tier, validFrom: list.validFrom?.toISOString().slice(0, 10) ?? '', validTo: list.validTo?.toISOString().slice(0, 10) ?? '' }}
        items={items.map((i) => ({
          productId: i.productId, sku: i.product.sku, name: i.product.name, unit: i.product.unit, unitsPerCase: i.product.unitsPerCase,
          retailPrice: i.product.retailPrice ? Number(i.product.retailPrice) : null, price: Number(i.price), minQty: i.minQty, qtyBreaks: parseQtyBreaks(i.qtyBreaks) ?? [],
        }))}
      />
    </section>
  );
}
