import { authorize, can } from '@michio/auth';
import { DomainError, getLeadDetail, getTimeline, listUsers } from '@michio/core';
import { ASSIGNMENT_METHOD_LABELS, ASSIGNMENT_STATUS_LABELS, formatDateTime, LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LeadStatusBadge, PriorityBadge } from '@/components/badges';
import { Countdown } from '@/components/countdown';
import { EditCustomerButton } from '@/components/customer-form';
import { CustomerProfile } from '@/components/customer-profile';
import { AcceptReturnButtons, AssignButton, LogActivityButton } from '@/components/lead-actions';
import { MergePanel } from '@/components/merge-panel';
import { Timeline } from '@/components/timeline';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Chi tiết lead' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('lead.view');
  const { id } = await params;
  const ctx = serviceContext(user);
  const lead = await getLeadDetail(ctx, id).catch((err) => {
    if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
    throw err;
  });
  const [timeline, users] = await Promise.all([getTimeline(ctx, { leadId: id }), can(user.role, 'lead.assign') ? listUsers(ctx) : Promise.resolve([])]);

  const pendingForMe = lead.assignments.find((a) => a.status === 'PENDING' && a.userId === user.id);
  const pending = lead.assignments.find((a) => a.status === 'PENDING');
  const isOpen = !['WON', 'LOST'].includes(lead.status);
  const canUpdate = authorize(user, 'lead.update', lead);
  const canEditCustomer = authorize(user, 'customer.update', lead.customer);
  const c = lead.customer;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/leads" className="text-sm text-muted-foreground hover:underline">← Lead</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Lead #{lead.code} · {c.contactName}</h1>
          <LeadStatusBadge status={lead.status} />
          <PriorityBadge priority={lead.priority} />
          {lead.isRepurchase && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Mua lại</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {LEAD_SOURCE_LABELS[lead.source]} · tạo {formatDateTime(lead.createdAt)}
          {lead.campaign && ` · chiến dịch ${lead.campaign}`}
          {lead.owner && ` · phụ trách: ${lead.owner.fullName}`}
        </p>
      </div>

      {pendingForMe && (
        <div className="rounded-xl border border-primary bg-primary/5 p-4" data-testid="accept-box">
          <p className="mb-3 text-sm font-medium">
            Lead này đang chờ bạn nhận
            {pendingForMe.acceptDeadline && (
              <>
                {' '}— hạn {formatDateTime(pendingForMe.acceptDeadline)} · <Countdown deadline={pendingForMe.acceptDeadline.toISOString()} />
              </>
            )}
          </p>
          <AcceptReturnButtons leadId={lead.id} code={lead.code} />
        </div>
      )}

      {lead.need && (
        <blockquote className="rounded-xl border-l-4 border-brand-green bg-surface px-4 py-3 text-sm">
          <span className="text-muted-foreground">Nhu cầu: </span>“{lead.need}”
        </blockquote>
      )}

      {isOpen && (
        <div className="flex flex-wrap gap-2">
          {canUpdate && lead.status === 'IN_PROGRESS' && <LogActivityButton leadId={lead.id} />}
          {can(user.role, 'lead.assign') && (
            <AssignButton
              leadIds={[lead.id]}
              users={users.map((u) => ({ id: u.id, fullName: u.fullName, role: u.role, status: u.status, openLeads: u.openLeads, maxOpenLeads: u.maxOpenLeads }))}
              currentOwnerId={lead.ownerId}
              label={lead.ownerId ? 'Chuyển cho…' : 'Giao cho…'}
            />
          )}
          {lead.status === 'IN_PROGRESS' && lead.ownerId === user.id && can(user.role, 'lead.return') && (
            <AcceptReturnButtons leadId={lead.id} code={lead.code} size="md" />
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <MergePanel customerId={c.id} />
          <CustomerProfile
            c={c}
            actions={
              <>
                <Link href={`/khach-hang/${c.id}`} className="text-sm font-medium text-primary hover:underline dark:text-brand-green">Hồ sơ khách</Link>
                {canEditCustomer && <EditCustomerButton customer={c} />}
              </>
            }
          />
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Thời hạn</h2>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5">
              <dt className="text-muted-foreground">Hạn nhận</dt>
              <dd>{pending?.acceptDeadline ? <>{formatDateTime(pending.acceptDeadline)} · <Countdown deadline={pending.acceptDeadline.toISOString()} /></> : lead.acceptedAt ? `Đã nhận ${formatDateTime(lead.acceptedAt)}` : '—'}</dd>
              <dt className="text-muted-foreground">Hạn liên hệ đầu tiên</dt>
              <dd>
                {lead.firstContactAt
                  ? `Đã liên hệ ${formatDateTime(lead.firstContactAt)}`
                  : lead.firstContactDeadline
                    ? <span className={lead.firstContactDeadline < new Date() ? 'font-semibold text-accent-text' : ''}>{formatDateTime(lead.firstContactDeadline)}</span>
                    : '—'}
              </dd>
              <dt className="text-muted-foreground">Số lần chuyển</dt>
              <dd>{lead.reassignCount}</dd>
            </dl>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Lịch sử giao</h2>
            <ul className="divide-y divide-border text-sm" data-testid="assignment-history">
              {lead.assignments.length === 0 && <li className="py-2 text-muted-foreground">Chưa giao</li>}
              {lead.assignments.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <strong>{a.user.fullName}</strong> · {ASSIGNMENT_METHOD_LABELS[a.method]}
                    {a.returnReason && <span className="text-muted-foreground"> · “{a.returnReason}”</span>}
                  </span>
                  <span className="text-muted-foreground">
                    {ASSIGNMENT_STATUS_LABELS[a.status]} · {formatDateTime(a.createdAt)}
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
