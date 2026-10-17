import { can } from '@michio/auth/permissions';
import { listQuotes } from '@michio/core';
import { formatDateTime, formatVnd, QUOTE_STATUS_LABELS } from '@michio/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { QuoteStatusBadge } from '@/components/badges';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Báo giá' };

type SP = Record<string, string | undefined>;

/** S9 — danh sách báo giá. */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('quote.view');
  const sp = await searchParams;
  const { items, nextCursor } = await listQuotes(serviceContext(user), { q: sp.q, status: sp.status, cursor: sp.cursor, limit: 30 });
  const next = nextCursor ? `?${new URLSearchParams({ ...(sp as Record<string, string>), cursor: nextCursor })}` : null;
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Báo giá</h1>
        {can(user.role, 'quote.manage') && <Link href="/bao-gia/moi" className={buttonVariants()}><Plus className="size-4" />Tạo báo giá</Link>}
      </div>
      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-4" role="search" aria-label="Lọc báo giá">
        <Input name="q" defaultValue={sp.q} placeholder="Mã BG, tên khách" aria-label="Tìm kiếm" className="col-span-2" />
        <Select name="status" defaultValue={sp.status ?? ''} aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          {Object.entries(QUOTE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>Lọc</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Mã</th><th className="p-3">Khách</th><th className="p-3">Sales</th><th className="p-3 text-right">Tổng</th><th className="p-3">Trạng thái</th><th className="p-3">Hiệu lực đến</th><th className="p-3">Tạo lúc</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Chưa có báo giá</td></tr>}
            {items.map((q) => (
              <tr key={q.id} className="hover:bg-muted/50">
                <td className="p-3 font-medium"><Link href={`/bao-gia/${q.id}`} className="hover:underline">{q.code}</Link></td>
                <td className="p-3">{q.customer.shopName ?? q.customer.contactName}</td>
                <td className="p-3">{q.owner.fullName}</td>
                <td className="p-3 text-right tabular-nums">{formatVnd(q.total)}</td>
                <td className="p-3"><QuoteStatusBadge status={q.status} />{q.orders[0] && <Link href={`/don-hang/${q.orders[0].id}`} className="ml-2 text-xs hover:underline">→ {q.orders[0].code}</Link>}</td>
                <td className="p-3">{formatDateTime(q.validUntil).slice(0, 10)}</td>
                <td className="p-3 text-muted-foreground">{formatDateTime(q.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && <div className="mt-4 flex justify-center"><Link href={next} className={buttonVariants({ variant: 'outline' })}>Trang sau →</Link></div>}
    </section>
  );
}
