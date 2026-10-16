import { authorize } from '@michio/auth';
import { DomainError, getCustomerDetail, getTimeline } from '@michio/core';
import { formatDateTime, LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LeadStatusBadge } from '@/components/badges';
import { EditCustomerButton } from '@/components/customer-form';
import { CustomerProfile } from '@/components/customer-profile';
import { MergePanel } from '@/components/merge-panel';
import { Timeline } from '@/components/timeline';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Hồ sơ khách' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('customer.view');
  const { id } = await params;
  const ctx = serviceContext(user);
  const c = await getCustomerDetail(ctx, id).catch((err) => {
    if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  const timeline = await getTimeline(ctx, { customerId: id });
  const canEdit = authorize(user, 'customer.update', c);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/khach-hang" className="text-sm text-muted-foreground hover:underline">← Khách hàng</Link>
        <h1 className="mt-1 text-2xl font-semibold">{c.shopName ?? c.contactName}</h1>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {canEdit && <MergePanel customerId={c.id} />}
          <CustomerProfile c={c} actions={canEdit ? <EditCustomerButton customer={c} /> : undefined} />
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Lead ({c.leads.length})</h2>
            <ul className="divide-y divide-border text-sm">
              {c.leads.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/leads/${l.id}`} className="hover:underline">
                    #{l.code} · {LEAD_SOURCE_LABELS[l.source]} · {formatDateTime(l.createdAt)}
                  </Link>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {l.owner?.fullName}
                    <LeadStatusBadge status={l.status} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Dòng thời gian</h2>
          <Timeline items={timeline.items} users={timeline.users} />
        </div>
      </div>
    </div>
  );
}
