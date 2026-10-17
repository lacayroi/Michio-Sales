import { authorize, can } from '@michio/auth';
import { DomainError, getCustomerDetail, getTimeline, listOrders, listPriceLists, listQuotes, topProducts } from '@michio/core';
import { formatDateTime, formatVnd, LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeliveryBadge, LeadStatusBadge, QuoteStatusBadge } from '@/components/badges';
import { CustomerCommerce } from '@/components/customer-commerce';
import { EditCustomerButton } from '@/components/customer-form';
import { CustomerProfile } from '@/components/customer-profile';
import { MergePanel } from '@/components/merge-panel';
import { Timeline } from '@/components/timeline';
import { buttonVariants } from '@/components/ui/button';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { RepeatOrderButton } from '../../don-hang/[id]/fulfillment';

export const metadata = { title: 'Hồ sơ khách' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('customer.view');
  const { id } = await params;
  const ctx = serviceContext(user);
  const c = await getCustomerDetail(ctx, id).catch((err) => {
    if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  const canEdit = authorize(user, 'customer.update', c);
  const owner = { orgId: c.orgId, ownerId: c.ownerId ?? user.id };
  const canQuote = authorize(user, 'quote.manage', owner);
  const canOrder = authorize(user, 'order.create', owner);
  const [timeline, quotes, orders, top, priceLists] = await Promise.all([
    getTimeline(ctx, { customerId: id }),
    can(user.role, 'quote.view') ? listQuotes(ctx, { customerId: id, limit: 10 }) : Promise.resolve({ items: [] }),
    can(user.role, 'order.view') ? listOrders(ctx, { customerId: id, limit: 10 }) : Promise.resolve({ items: [], totals: { count: 0, revenue: 0 } }),
    c.orderCount > 0 ? topProducts(ctx, id) : Promise.resolve([]),
    can(user.role, 'priceList.manage') ? listPriceLists(ctx) : Promise.resolve(null),
  ]);
  const lastOrder = orders.items.find((o) => o.deliveryStatus !== 'CANCELLED');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/khach-hang" className="text-sm text-muted-foreground hover:underline">← Khách hàng</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-2xl font-semibold">{c.shopName ?? c.contactName}</h1>
          {canQuote && <Link href={`/bao-gia/moi?customerId=${c.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Tạo báo giá</Link>}
          {canOrder && <Link href={`/don-hang/moi?customerId=${c.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Ghi nhận đơn</Link>}
          {canQuote && lastOrder && <RepeatOrderButton orderId={lastOrder.id} />}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {canEdit && <MergePanel customerId={c.id} />}
          <CustomerProfile c={c} actions={canEdit ? <EditCustomerButton customer={c} /> : undefined} />
          {canEdit && (
            <CustomerCommerce
              customerId={c.id}
              priceListId={c.priceListId}
              priceLists={priceLists?.map((l) => ({ id: l.id, name: l.name, tier: l.tier })) ?? null}
              cycleDays={c.reorderCycleDays}
              cycleLocked={c.reorderCycleLocked}
            />
          )}
          {top.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Mua nhiều nhất</h2>
              <ol className="list-decimal pl-5 text-sm">
                {top.map((p) => <li key={p.id}>{p.name} <span className="text-muted-foreground">· {p.qty} {p.unit ?? ''} · {formatVnd(p.revenue)}</span></li>)}
              </ol>
            </div>
          )}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Lead ({c.leads.length})</h2>
            <ul className="divide-y divide-border text-sm">
              {c.leads.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/leads/${l.id}`} className="hover:underline">#{l.code} · {LEAD_SOURCE_LABELS[l.source]} · {formatDateTime(l.createdAt)}</Link>
                  <span className="flex items-center gap-2 text-muted-foreground">{l.owner?.fullName}<LeadStatusBadge status={l.status} /></span>
                </li>
              ))}
            </ul>
          </div>
          {quotes.items.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Báo giá</h2>
              <ul className="divide-y divide-border text-sm">
                {quotes.items.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/bao-gia/${q.id}`} className="hover:underline">{q.code} · {formatVnd(q.total)}</Link>
                    <span className="flex items-center gap-2 text-muted-foreground">{formatDateTime(q.createdAt).slice(0, 10)}<QuoteStatusBadge status={q.status} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {orders.items.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Đơn sỉ</h2>
              <ul className="divide-y divide-border text-sm">
                {orders.items.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/don-hang/${o.id}`} className="hover:underline">{o.code} · {formatVnd(o.total)}</Link>
                    <span className="flex items-center gap-2 text-muted-foreground">{formatDateTime(o.orderedAt).slice(0, 10)}<DeliveryBadge status={o.deliveryStatus} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Dòng thời gian</h2>
          <Timeline items={timeline.items} users={timeline.users} />
        </div>
      </div>
    </div>
  );
}
