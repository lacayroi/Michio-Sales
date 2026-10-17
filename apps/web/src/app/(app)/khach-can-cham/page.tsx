import { can } from '@michio/auth';
import { listAttention, listUsers } from '@michio/core';
import { formatDate, formatVnd, LIFECYCLE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { PhoneActions } from '@/components/phone-actions';
import { buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Khách cần chăm' };

const GROUPS = [
  { key: '', label: 'Tất cả' },
  { key: 'overdue', label: 'Quá hạn đặt lại' },
  { key: 'due', label: 'Sắp đến hạn' },
  { key: 'at_risk', label: 'Có nguy cơ' },
  { key: 'dormant', label: 'Ngủ đông' },
] as const;

/** S8 (SPEC 6.8): sắp đến hạn đặt lại, quá hạn, ngủ đông — sắp xếp theo giá trị đơn trung bình. */
export default async function AttentionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('customer.update');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const [data, users] = await Promise.all([
    listAttention(ctx, { group: (sp.group || undefined) as never, ownerId: sp.ownerId || undefined }),
    can(user.role, 'lead.assign') ? listUsers(ctx) : Promise.resolve([]),
  ]);
  const total = data.counts.due + data.counts.overdue + data.counts.at_risk + data.counts.dormant;
  const count = (k: string) => (k ? data.counts[k as keyof typeof data.counts] : total);
  const qs = (group: string) => `/khach-can-cham?${new URLSearchParams(Object.entries({ group, ownerId: sp.ownerId ?? '' }).filter(([, v]) => v))}`;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Khách cần chăm</h1>
        {users.length > 0 && (
          <form className="flex gap-2">
            <input type="hidden" name="group" value={sp.group ?? ''} />
            <Select name="ownerId" defaultValue={sp.ownerId ?? ''} className="w-48" aria-label="Sales"><option value="">Mọi sales</option>{users.filter((u) => u.role === 'SALES').map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select>
            <button type="submit" className={buttonVariants({ variant: 'outline' })}>Lọc</button>
          </form>
        )}
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Nhóm khách">
        {GROUPS.map((g) => (
          <Link key={g.key} href={qs(g.key)} aria-current={(sp.group ?? '') === g.key ? 'page' : undefined}
            className={cn('rounded-full px-3 py-1.5 text-sm font-medium', (sp.group ?? '') === g.key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}>
            {g.label} <span className="tabular-nums opacity-80">{count(g.key)}</span>
          </Link>
        ))}
      </nav>
      <ul className="grid gap-3 lg:grid-cols-2" data-testid="attention-list">
        {data.items.length === 0 && <li className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground lg:col-span-2">Không có khách nào trong nhóm này 🎉</li>}
        {data.items.map((c) => (
          <li key={c.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link href={`/khach-hang/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
                <p className="text-sm text-muted-foreground">{[c.contactName !== c.name ? c.contactName : null, c.province, c.owner?.fullName].filter(Boolean).join(' · ')}</p>
              </div>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', c.group === 'overdue' || c.group === 'at_risk' ? 'bg-accent/15 text-accent-text' : 'bg-muted')}>
                {c.group === 'overdue' ? 'Quá hạn đặt lại' : c.group === 'due' ? 'Sắp đến hạn' : LIFECYCLE_LABELS[c.lifecycle]}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Đơn gần nhất</dt><dd>{c.lastOrderAt ? `${formatDate(c.lastOrderAt)} (${c.daysSinceOrder} ngày)` : '—'}</dd>
              <dt className="text-muted-foreground">Hẹn đặt lại</dt><dd>{c.nextReorderAt ? formatDate(c.nextReorderAt) : '—'} · chu kỳ {c.reorderCycleDays} ngày</dd>
              <dt className="text-muted-foreground">Giá trị đơn TB</dt><dd className="tabular-nums">{formatVnd(c.avgOrderValue)} · {c.orderCount} đơn</dd>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PhoneActions phone={c.phone} compact />
              {c.openTask && <Link href={`/viec-cua-toi?task=${c.openTask.id}`} className="text-xs text-muted-foreground hover:underline">Việc V{c.openTask.code} · {formatDate(c.openTask.dueAt)}</Link>}
              <Link href={`/bao-gia/moi?customerId=${c.id}`} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'ml-auto' })}>Tạo báo giá</Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
