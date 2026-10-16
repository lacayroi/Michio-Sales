import { can } from '@michio/auth';
import { type CustomerFilters, listCustomers } from '@michio/core';
import { prisma } from '@michio/db';
import { BUSINESS_MODEL_LABELS, formatDate, formatVnd, LIFECYCLE_LABELS, toLocalVnPhone } from '@michio/shared';
import { Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { LifecycleBadge } from '@/components/lead-badges';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { navItem } from '@/lib/nav';
import { requireUser } from '@/lib/session';

const HREF = '/khach-hang';
export const metadata = { title: navItem(HREF).label };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('customer.view');
  const sp = await searchParams;
  const filters: CustomerFilters = {
    q: sp.q,
    lifecycle: sp.lifecycle ? (sp.lifecycle.split(',') as CustomerFilters['lifecycle']) : undefined,
  };
  const page = await listCustomers(prisma, user, filters, { cursor: sp.cursor, limit: 30 });
  const next = new URLSearchParams(Object.entries({ q: sp.q, lifecycle: sp.lifecycle, cursor: page.nextCursor ?? undefined }).filter(([, v]) => v) as [string, string][]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Khách hàng</h1>
        {can(user.role, 'import.manage') && (
          <Link href="/khach-hang/import" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Upload className="size-4" /> Import Excel
          </Link>
        )}
      </div>
      <form className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:items-center" role="search">
        <div className="relative col-span-2 sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={sp.q} placeholder="Tên, shop, SĐT, email…" aria-label="Tìm khách" className="pl-9 sm:h-10 sm:text-sm" />
        </div>
        <Select name="lifecycle" defaultValue={sp.lifecycle ?? ''} aria-label="Vòng đời" className="sm:w-48">
          <option value="">Mọi vòng đời</option>
          {Object.entries(LIFECYCLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>
          Lọc
        </button>
      </form>

      {page.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center">
          <p className="font-medium">Không có khách hàng nào</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left text-xs font-semibold text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2">Khách</th>
                <th className="px-3 py-2">SĐT</th>
                <th className="hidden px-3 py-2 md:table-cell">Mô hình</th>
                <th className="px-3 py-2">Vòng đời</th>
                <th className="hidden px-3 py-2 lg:table-cell">Doanh số</th>
                <th className="hidden px-3 py-2 lg:table-cell">Hẹn tái đặt</th>
                {user.role !== 'SALES' && <th className="hidden px-3 py-2 md:table-cell">Phụ trách</th>}
              </tr>
            </thead>
            <tbody>
              {page.items.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="max-w-64 px-3 py-2">
                    <Link href={`/khach-hang/${c.id}`} className="block truncate font-medium text-primary hover:underline">
                      {c.shopName ?? c.contactName}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">{[c.shopName ? c.contactName : null, c.province].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{c.phone ? toLocalVnPhone(c.phone) : '—'}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{c.businessModel ? BUSINESS_MODEL_LABELS[c.businessModel] : '—'}</td>
                  <td className="px-3 py-2">
                    <LifecycleBadge lifecycle={c.lifecycle} />
                  </td>
                  <td className="hidden px-3 py-2 whitespace-nowrap lg:table-cell">{c.orderCount ? `${formatVnd(c.totalRevenue)} · ${c.orderCount} đơn` : '—'}</td>
                  <td className="hidden px-3 py-2 whitespace-nowrap lg:table-cell">{c.nextReorderAt ? formatDate(c.nextReorderAt) : '—'}</td>
                  {user.role !== 'SALES' && <td className="hidden px-3 py-2 md:table-cell">{c.owner?.fullName ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor && (
        <div className="mt-3 flex justify-center">
          <Link href={`${HREF}?${next}`} className={buttonVariants({ variant: 'outline' })}>
            Trang sau
          </Link>
        </div>
      )}
    </section>
  );
}
