import { can } from '@michio/auth/permissions';
import { listOrders } from '@michio/core';
import { DELIVERY_STATUS_LABELS, formatDateTime, formatVnd, PAYMENT_STATUS_LABELS } from '@michio/shared';
import { Download, Plus } from 'lucide-react';
import Link from 'next/link';
import { DeliveryBadge, PaymentBadge } from '@/components/badges';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Đơn sỉ' };

type SP = Record<string, string | undefined>;

/** S10 — đơn sỉ: lọc, cập nhật giao hàng / thanh toán (Support), xuất Excel cho kế toán. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('order.view');
  const sp = await searchParams;
  // Date inputs are whole Vietnam days: [from 00:00, to + 1 day 00:00).
  const day = (d: string | undefined, plus = 0) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(new Date(`${d}T00:00:00+07:00`).getTime() + plus * 86_400_000).toISOString() : undefined);
  const filters = { q: sp.q, paymentStatus: sp.paymentStatus, deliveryStatus: sp.deliveryStatus, from: day(sp.from), to: day(sp.to, 1) };
  const { items, nextCursor, totals } = await listOrders(serviceContext(user), { ...filters, cursor: sp.cursor, limit: 30 });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  const next = nextCursor ? `?${new URLSearchParams({ ...Object.fromEntries(qs), cursor: nextCursor })}` : null;
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Đơn sỉ</h1>
        <div className="flex gap-2">
          {can(user.role, 'export.orders') && <a href={`/api/v1/orders/export?${qs}`} className={buttonVariants({ variant: 'outline' })}><Download className="size-4" />Xuất Excel</a>}
          {can(user.role, 'order.create') && <Link href="/don-hang/moi" className={buttonVariants()}><Plus className="size-4" />Tạo đơn</Link>}
        </div>
      </div>
      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label="Lọc đơn">
        <Input name="q" defaultValue={sp.q} placeholder="Mã đơn, khách, vận đơn" aria-label="Tìm kiếm" className="col-span-2" />
        <Select name="deliveryStatus" defaultValue={sp.deliveryStatus ?? ''} aria-label="Giao hàng">
          <option value="">Mọi trạng thái giao</option>
          <option value="PENDING,PACKING,SHIPPING">Chưa giao xong</option>
          {Object.entries(DELIVERY_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="paymentStatus" defaultValue={sp.paymentStatus ?? ''} aria-label="Thanh toán">
          <option value="">Mọi thanh toán</option>
          <option value="UNPAID,PARTIAL">Chưa thu đủ</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input type="date" name="from" defaultValue={sp.from} aria-label="Từ ngày" />
        <div className="flex gap-2"><Input type="date" name="to" defaultValue={sp.to} aria-label="Đến ngày" /><button type="submit" className={buttonVariants({ variant: 'outline' })}>Lọc</button></div>
      </form>
      <p className="mb-2 text-sm text-muted-foreground" data-testid="orders-total">{totals.count} đơn không hủy · doanh số {formatVnd(totals.revenue)}</p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Mã</th><th className="p-3">Ngày đặt</th><th className="p-3">Khách</th><th className="p-3">Sales</th><th className="p-3 text-right">Tổng</th><th className="p-3">Thanh toán</th><th className="p-3">Giao hàng</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Chưa có đơn</td></tr>}
            {items.map((o) => (
              <tr key={o.id} className="hover:bg-muted/50">
                <td className="p-3 font-medium"><Link href={`/don-hang/${o.id}`} className="hover:underline">{o.code}</Link></td>
                <td className="p-3">{formatDateTime(o.orderedAt)}</td>
                <td className="p-3">{o.customer.shopName ?? o.customer.contactName}<span className="block text-xs text-muted-foreground">{o.customer.province}</span></td>
                <td className="p-3">{o.owner.fullName}</td>
                <td className="p-3 text-right tabular-nums">{formatVnd(o.total)}</td>
                <td className="p-3"><PaymentBadge status={o.paymentStatus} /></td>
                <td className="p-3"><DeliveryBadge status={o.deliveryStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && <div className="mt-4 flex justify-center"><Link href={next} className={buttonVariants({ variant: 'outline' })}>Trang sau →</Link></div>}
    </section>
  );
}
