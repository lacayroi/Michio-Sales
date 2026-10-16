import { authorize, can } from '@michio/auth';
import { assignableUsers, getLead, leadTimeline, NotFoundError } from '@michio/core';
import { prisma } from '@michio/db';
import { ASSIGNMENT_METHOD_LABELS, ASSIGNMENT_STATUS_LABELS, formatDateTime, LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Countdown } from '@/components/countdown';
import { CustomerProfile } from '@/components/customer-profile';
import { LeadStatusBadge, PriorityBadge } from '@/components/lead-badges';
import { Timeline } from '@/components/timeline';
import { Card, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/session';
import { ActivityForm } from './activity-form';
import { LeadActions } from './lead-actions';

export const metadata = { title: 'Lead' };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('lead.view');
  const { id } = await params;
  const lead = await getLead(prisma, user, id).catch((e) => {
    if (e instanceof NotFoundError || (e as { code?: string }).code === 'FORBIDDEN') notFound();
    throw e;
  });
  const isManager = can(user.role, 'lead.assign');
  const [timeline, users, lostReasons] = await Promise.all([
    leadTimeline(prisma, user, id),
    isManager ? assignableUsers(prisma, user.orgId) : Promise.resolve([]),
    prisma.lostReason.findMany({ where: { orgId: user.orgId, isActive: true }, orderBy: { name: 'asc' } }),
  ]);
  const pending = lead.assignments.find((a) => a.status === 'PENDING');
  const myPending = pending?.userId === user.id;
  const canEdit = authorize(user, 'lead.update', lead);
  const closed = lead.status === 'WON' || lead.status === 'LOST';
  const c = lead.customer;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/leads" className="text-sm text-muted-foreground hover:underline">
          ← Danh sách lead
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">
            Lead #{lead.code} · {c.contactName}
          </h1>
          <PriorityBadge priority={lead.priority} />
          <LeadStatusBadge status={lead.status} />
          {lead.isRepurchase && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Khách mua lại</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {LEAD_SOURCE_LABELS[lead.source]} · tạo {formatDateTime(lead.createdAt)}
          {lead.owner ? ` · phụ trách: ${lead.owner.fullName}` : ' · chưa có người phụ trách'}
        </p>
      </div>

      {pending?.acceptDeadline && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${myPending ? 'border-primary bg-primary/5' : 'border-border bg-surface'}`}>
          <p className="text-sm font-medium">
            {myPending ? 'Lead đang chờ bạn nhận' : `Đang chờ ${pending.user.fullName} nhận`} — hạn {formatDateTime(pending.acceptDeadline)}
          </p>
          <Countdown deadline={pending.acceptDeadline.toISOString()} />
        </div>
      )}

      <LeadActions
        leadId={lead.id}
        canAccept={myPending}
        canReturn={user.role === 'SALES' && lead.ownerId === user.id && !closed}
        assignees={isManager && !closed ? users.map((u) => ({ id: u.id, fullName: u.fullName })) : null}
        lostReasons={canEdit && !closed ? lostReasons.map((r) => ({ id: r.id, name: r.name })) : null}
        canDelete={can(user.role, 'record.delete')}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>Hồ sơ khách sỉ</CardTitle>
              <Link href={`/khach-hang/${c.id}`} className="text-sm font-medium text-primary hover:underline">
                Mở hồ sơ{authorize(user, 'customer.update', c) ? ' / sửa' : ''}
              </Link>
            </div>
            <CustomerProfile c={c} />
          </Card>
          <Card>
            <CardTitle>Nhu cầu</CardTitle>
            <p className="mt-2 text-sm whitespace-pre-line">{lead.need || '—'}</p>
            {lead.campaign && <p className="mt-2 text-xs text-muted-foreground">Chiến dịch: {lead.campaign}</p>}
            {lead.firstContactAt ? (
              <p className="mt-2 text-xs text-muted-foreground">Liên hệ đầu tiên: {formatDateTime(lead.firstContactAt)}</p>
            ) : lead.firstContactDeadline ? (
              <p className={`mt-2 text-xs ${lead.firstContactDeadline < new Date() ? 'font-semibold text-accent-text' : 'text-muted-foreground'}`}>
                Hạn liên hệ đầu tiên: {formatDateTime(lead.firstContactDeadline)}
              </p>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {canEdit && !closed && (
            <Card>
              <CardTitle>Ghi nhận hoạt động</CardTitle>
              <ActivityForm leadId={lead.id} />
            </Card>
          )}
          <Card>
            <CardTitle>Dòng thời gian</CardTitle>
            <Timeline items={timeline.map((t) => ({ id: t.id, type: t.type, data: t.data, createdAt: t.createdAt.toISOString(), userName: t.userName }))} />
          </Card>
          <Card>
            <CardTitle>Lịch sử giao lead</CardTitle>
            {lead.assignments.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Chưa giao cho ai</p>
            ) : (
              <ul className="mt-2 divide-y divide-border text-sm" data-testid="assignment-history">
                {lead.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                    <span>
                      <span className="font-medium">{a.user.fullName}</span>
                      <span className="text-muted-foreground"> · {ASSIGNMENT_METHOD_LABELS[a.method]}</span>
                      {a.returnReason && <span className="text-muted-foreground"> · “{a.returnReason}”</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ASSIGNMENT_STATUS_LABELS[a.status]} · {formatDateTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}
