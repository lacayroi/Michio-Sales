import { authorize } from '@michio/auth';
import { DomainError, getOrder } from '@michio/core';
import { formatDateTime, formatVnd, PAYMENT_METHOD_LABELS } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeliveryBadge, PaymentBadge } from '@/components/badges';
import { PhoneActions } from '@/components/phone-actions';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { FulfillmentPanel, RepeatOrderButton } from './fulfillment';

export const metadata = { title: 'Đơn sỉ' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('order.view');
  const { id } = await params;
  const o = await getOrder(serviceContext(user), id).catch((err) => {
    if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  const canFulfil = authorize(user, 'order.updateFulfillment', o);
  const canRepeat = authorize(user, 'quote.manage', { orgId: o.orgId, ownerId: o.customer.ownerId ?? o.ownerId });
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/don-hang" className="text-sm text-muted-foreground hover:underline">← Đơn sỉ</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="order-code">{o.code}</h1>
          <PaymentBadge status={o.paymentStatus} />
          <DeliveryBadge status={o.deliveryStatus} />
          {canRepeat && <RepeatOrderButton orderId={o.id} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Đặt {formatDateTime(o.orderedAt)} · {o.owner.fullName}
          {o.quote && (
            <span>
              {' · từ '}
              <Link href={`/bao-gia/${o.quote.id}`} className="hover:underline">{o.quote.code}</Link>
            </span>
          )}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Sản phẩm</th><th className="p-3 text-right">SL</th><th className="p-3 text-right">Đơn giá</th><th className="p-3 text-right">CK</th><th className="p-3 text-right">Thành tiền</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.items.map((l) => (
                  <tr key={l.id}>
                    <td className="p-3"><p className="font-medium">{l.product.name}</p><p className="text-xs text-muted-foreground">{l.product.sku}</p></td>
                    <td className="p-3 text-right tabular-nums">{Number(l.qty)}</td>
                    <td className="p-3 text-right tabular-nums">{formatVnd(l.unitPrice)}</td>
                    <td className="p-3 text-right tabular-nums">{Number(l.discount) ? formatVnd(l.discount) : ''}</td>
                    <td className="p-3 text-right font-medium tabular-nums">{formatVnd(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border">
                <tr><td colSpan={4} className="p-2 pr-3 text-right text-muted-foreground">Tiền hàng</td><td className="p-2 pr-3 text-right tabular-nums">{formatVnd(o.subtotal)}</td></tr>
                {Number(o.discount) > 0 && <tr><td colSpan={4} className="p-2 pr-3 text-right text-muted-foreground">Chiết khấu</td><td className="p-2 pr-3 text-right tabular-nums">−{formatVnd(o.discount)}</td></tr>}
                {Number(o.shippingFee) > 0 && <tr><td colSpan={4} className="p-2 pr-3 text-right text-muted-foreground">Phí vận chuyển</td><td className="p-2 pr-3 text-right tabular-nums">{formatVnd(o.shippingFee)}</td></tr>}
                <tr><td colSpan={4} className="p-3 text-right font-semibold">Tổng cộng</td><td className="p-3 text-right text-base font-semibold tabular-nums">{formatVnd(o.total)}</td></tr>
              </tfoot>
            </table>
          </div>
          {o.note && <p className="whitespace-pre-line rounded-xl border border-border bg-surface p-3 text-sm"><span className="font-medium">Ghi chú: </span>{o.note}</p>}
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p className="font-semibold"><Link href={`/khach-hang/${o.customer.id}`} className="hover:underline">{o.customer.shopName ?? o.customer.contactName}</Link></p>
            <div className="my-2"><PhoneActions phone={o.customer.phone} /></div>
            <p className="text-muted-foreground">Giao đến: {o.shippingAddress ?? '—'}</p>
            <p className="text-muted-foreground">Thanh toán: {PAYMENT_METHOD_LABELS[o.paymentMethod]} · đã trả {formatVnd(o.paidAmount)}</p>
            {o.trackingCode && <p className="text-muted-foreground">Mã vận đơn: {o.trackingCode}</p>}
          </div>
          {canFulfil && <FulfillmentPanel orderId={o.id} payment={o.paymentStatus} paid={Number(o.paidAmount)} total={Number(o.total)} delivery={o.deliveryStatus} tracking={o.trackingCode} />}
        </div>
      </div>
    </section>
  );
}
