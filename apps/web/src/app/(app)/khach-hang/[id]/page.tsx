import { authorize, can } from '@michio/auth';
import { customerTimeline, getCustomer, mergeSuggestions, NotFoundError } from '@michio/core';
import { prisma } from '@michio/db';
import { formatDate, formatDateTime, formatVnd, LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerProfile } from '@/components/customer-profile';
import { LeadStatusBadge } from '@/components/lead-badges';
import { Timeline } from '@/components/timeline';
import { Card, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/session';
import { CustomerEditor } from './customer-editor';

export const metadata = { title: 'Khách hàng' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('customer.view');
  const { id } = await params;
  const c = await getCustomer(prisma, user, id).catch((e) => {
    if (e instanceof NotFoundError || (e as { code?: string }).code === 'FORBIDDEN') notFound();
    throw e;
  });
  const canEdit = authorize(user, 'customer.update', c);
  const [timeline, suggestions, priceLists] = await Promise.all([
    customerTimeline(prisma, user, id),
    canEdit ? mergeSuggestions(prisma, user, id) : Promise.resolve([]),
    can(user.role, 'priceList.manage') ? prisma.priceList.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true, tier: true } }) : Promise.resolve([]),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/khach-hang" className="text-sm text-muted-foreground hover:underline">
          ← Khách hàng
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{c.shopName ?? c.contactName}</h1>
        <p className="text-sm text-muted-foreground">Khách từ {formatDate(c.createdAt)}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>Hồ sơ khách sỉ</CardTitle>
            </div>
            <CustomerProfile c={c} />
            {canEdit && (
              <CustomerEditor
                customer={{
                  id: c.id,
                  contactName: c.contactName,
                  phone: c.phone,
                  zaloPhone: c.zaloPhone,
                  email: c.email,
                  shopName: c.shopName,
                  taxCode: c.taxCode,
                  businessModel: c.businessModel,
                  expectedOrderBand: c.expectedOrderBand,
                  interestCategories: c.interestCategories,
                  province: c.province,
                  address: c.address,
                  facebookUrl: c.facebookUrl,
                  tags: c.tags,
                  note: c.note,
                  tier: c.tier,
                  priceListId: c.priceListId,
                  reorderCycleDays: c.reorderCycleDays,
                }}
                priceLists={priceLists.length ? priceLists : null}
                suggestions={suggestions.map((s) => ({ id: s.id, label: `${s.contactName}${s.shopName ? ` · ${s.shopName}` : ''} · ${s.province}` }))}
              />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Lead</CardTitle>
            {c.leads.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Chưa có lead</p>
            ) : (
              <ul className="mt-2 divide-y divide-border text-sm">
                {c.leads.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/leads/${l.id}`} className="font-medium text-primary hover:underline">
                      #{l.code} · {LEAD_SOURCE_LABELS[l.source]}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {l.owner?.fullName ?? 'Chưa giao'} · {formatDateTime(l.createdAt)} <LeadStatusBadge status={l.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {c.orders.length > 0 && (
            <Card>
              <CardTitle>Đơn sỉ gần đây</CardTitle>
              <ul className="mt-2 divide-y divide-border text-sm">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex justify-between gap-2 py-2">
                    <span className="font-medium">{o.code}</span>
                    <span className="text-muted-foreground">
                      {formatDate(o.orderedAt)} · {formatVnd(o.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardTitle>Dòng thời gian</CardTitle>
            <Timeline items={timeline.map((t) => ({ id: t.id, type: t.type, data: t.data, createdAt: t.createdAt.toISOString(), userName: t.userName }))} />
          </Card>
        </div>
      </div>
    </section>
  );
}
