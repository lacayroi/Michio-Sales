import { DomainError, getQuote } from '@michio/core';
import { formatDateTime, formatVnd } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { QuoteStatusBadge } from '@/components/badges';
import { buttonVariants } from '@/components/ui/button';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { QuoteActions } from './actions';

export const metadata = { title: 'Báo giá' };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('quote.view');
  const { id } = await params;
  const r = await getQuote(serviceContext(user), id).catch((err) => {
    if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  const q = r.quote;
  const c = q.customer;
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/bao-gia" className="text-sm text-muted-foreground hover:underline">← Báo giá</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="quote-code">{q.code}</h1>
          <QuoteStatusBadge status={q.status} />
          {q.orders[0] && <Link href={`/don-hang/${q.orders[0].id}`} className="text-sm font-medium text-primary hover:underline dark:text-brand-green">Đơn {q.orders[0].code} →</Link>}
        </div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/khach-hang/${c.id}`} className="hover:underline">{c.shopName ?? c.contactName}</Link> · {q.owner.fullName} · tạo {formatDateTime(q.createdAt)}
          {q.sentAt && ` · gửi ${formatDateTime(q.sentAt)}`} · hiệu lực đến {formatDateTime(q.validUntil).slice(0, 10)}
        </p>
      </div>

      <QuoteActions
        quoteId={q.id}
        code={q.code}
        status={q.status}
        can={r.can}
        messenger={r.messenger.map((m) => ({ id: m.id, name: m.name, ok: m.window.ok, reason: m.window.ok ? null : m.window.reason }))}
        address={c.address}
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr><th className="p-3">#</th><th className="p-3">Sản phẩm</th><th className="p-3 text-right">SL</th><th className="p-3 text-right">Đơn giá</th><th className="p-3 text-right">CK</th><th className="p-3 text-right">Thành tiền</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {r.items.map((l, i) => (
              <tr key={`${l.productId}-${i}`}>
                <td className="p-3 text-muted-foreground">{i + 1}</td>
                <td className="p-3"><p className="font-medium">{l.name}</p><p className="text-xs text-muted-foreground">{l.sku}{l.unitsPerCase ? ` · ${l.unitsPerCase} ${l.unit ?? ''}/thùng` : ''}{l.priceSource === 'RETAIL' && <span className="text-accent-text"> · giá lẻ</span>}</p></td>
                <td className="p-3 text-right tabular-nums">{l.qty}</td>
                <td className="p-3 text-right tabular-nums">{formatVnd(l.unitPrice)}</td>
                <td className="p-3 text-right">{l.discountPct ? `${l.discountPct}%` : ''}</td>
                <td className="p-3 text-right font-medium tabular-nums">{formatVnd(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border text-sm">
            <tr><td colSpan={5} className="p-2 pr-3 text-right text-muted-foreground">Tiền hàng</td><td className="p-2 pr-3 text-right tabular-nums">{formatVnd(q.subtotal)}</td></tr>
            {Number(q.discount) > 0 && <tr><td colSpan={5} className="p-2 pr-3 text-right text-muted-foreground">Chiết khấu thêm</td><td className="p-2 pr-3 text-right tabular-nums">−{formatVnd(q.discount)}</td></tr>}
            {Number(q.shippingFee) > 0 && <tr><td colSpan={5} className="p-2 pr-3 text-right text-muted-foreground">Phí vận chuyển</td><td className="p-2 pr-3 text-right tabular-nums">{formatVnd(q.shippingFee)}</td></tr>}
            <tr><td colSpan={5} className="p-3 text-right font-semibold">Tổng cộng</td><td className="p-3 text-right text-base font-semibold tabular-nums" data-testid="quote-total">{formatVnd(q.total)}</td></tr>
          </tfoot>
        </table>
      </div>
      {q.terms && <p className="whitespace-pre-line rounded-xl border border-border bg-surface p-3 text-sm"><span className="font-medium">Điều kiện: </span>{q.terms}</p>}
      <div className="flex gap-2">
        <a href={`/api/v1/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>Xem PDF</a>
        <a href={`/api/v1/quotes/${q.id}/pdf?download=1`} className={buttonVariants({ variant: 'outline' })}>Tải PDF (gửi Zalo)</a>
      </div>
    </section>
  );
}
