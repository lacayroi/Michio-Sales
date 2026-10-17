import { getCustomerDetail } from '@michio/core';
import Link from 'next/link';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { OrderForm } from '../order-form';

export const metadata = { title: 'Tạo đơn sỉ' };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('order.create');
  const sp = await searchParams;
  const c = sp.customerId ? await getCustomerDetail(serviceContext(user), sp.customerId).catch(() => null) : null;
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/don-hang" className="text-sm text-muted-foreground hover:underline">← Đơn sỉ</Link>
        <h1 className="mt-1 text-2xl font-semibold">Ghi nhận đơn sỉ</h1>
        {sp.dealId && <p className="text-sm text-muted-foreground">Đơn này sẽ chốt cơ hội đang mở của khách.</p>}
      </div>
      <OrderForm customer={c ? { id: c.id, contactName: c.contactName, shopName: c.shopName, phone: c.phone, province: c.province } : null} dealId={sp.dealId ?? null} />
    </section>
  );
}
