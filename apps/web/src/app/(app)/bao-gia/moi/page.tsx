import { can } from '@michio/auth/permissions';
import { getCustomerDetail, getSettings } from '@michio/core';
import Link from 'next/link';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { QuoteBuilder } from '../quote-builder';

export const metadata = { title: 'Tạo báo giá' };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('quote.manage');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const customer = sp.customerId ? await getCustomerDetail(ctx, sp.customerId).catch(() => null) : null;
  const { 'quote.maxExtraDiscountPct': max } = await getSettings(ctx.db, ctx.orgId, ['quote.maxExtraDiscountPct']);
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/bao-gia" className="text-sm text-muted-foreground hover:underline">← Báo giá</Link>
        <h1 className="mt-1 text-2xl font-semibold">Tạo báo giá sỉ</h1>
      </div>
      <QuoteBuilder
        customer={customer ? { id: customer.id, contactName: customer.contactName, shopName: customer.shopName, phone: customer.phone, province: customer.province } : null}
        dealId={sp.dealId ?? null}
        maxDiscountPct={max}
        canApprove={can(user.role, 'quote.approve')}
      />
    </section>
  );
}
