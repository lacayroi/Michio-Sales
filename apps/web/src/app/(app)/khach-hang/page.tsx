import { can } from '@michio/auth/permissions';
import { listCustomers } from '@michio/core';
import { BUSINESS_MODEL_LABELS, formatDate, LIFECYCLE_LABELS } from '@michio/shared';
import { Upload } from 'lucide-react';
import Link from 'next/link';
import { LifecycleBadge } from '@/components/badges';
import { PhoneActions } from '@/components/phone-actions';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Khách hàng' };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('customer.view');
  const sp = await searchParams;
  const { items, nextCursor } = await listCustomers(serviceContext(user), { ...sp, limit: 30 });
  const next = nextCursor ? `?${new URLSearchParams({ ...(sp as Record<string, string>), cursor: nextCursor })}` : null;
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Khách hàng</h1>
        {can(user.role, 'import.manage') && (
          <Link href="/khach-hang/import" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Upload className="size-4" aria-hidden /> Import Excel
          </Link>
        )}
      </div>
      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-4" role="search" aria-label="Lọc khách hàng">
        <Input name="q" defaultValue={sp.q} placeholder="Tên, shop, SĐT, email" aria-label="Tìm kiếm" className="col-span-2" />
        <Select name="lifecycle" defaultValue={sp.lifecycle ?? ''} aria-label="Vòng đời">
          <option value="">Mọi trạng thái</option>
          {Object.entries(LIFECYCLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <button type="submit" className={buttonVariants()}>Lọc</button>
      </form>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Không có khách hàng nào phù hợp.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/khach-hang/${c.id}`} className="font-medium hover:underline">{c.shopName ?? c.contactName}</Link>
                <p className="text-xs text-muted-foreground">
                  {[c.shopName && c.contactName, c.businessModel && BUSINESS_MODEL_LABELS[c.businessModel], c.province, c.owner?.fullName && `Phụ trách: ${c.owner.fullName}`, c.lastOrderAt && `Đơn gần nhất ${formatDate(c.lastOrderAt)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="flex items-center gap-3">
                <PhoneActions phone={c.phone} compact />
                <LifecycleBadge lifecycle={c.lifecycle} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="mt-4 flex justify-center">
          <Link href={next} className={buttonVariants({ variant: 'outline' })}>Trang sau →</Link>
        </div>
      )}
    </section>
  );
}
