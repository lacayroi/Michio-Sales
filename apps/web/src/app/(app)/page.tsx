import { can, scopeFilter } from '@michio/auth';
import { managerHome, salesHome } from '@michio/core';
import { prisma } from '@michio/db';
import {
  BUSINESS_MODEL_LABELS, formatDate, formatDateTime, formatVnd, INTEREST_CATEGORY_LABELS, LEAD_SOURCE_LABELS, ORDER_BAND_LABELS,
} from '@michio/shared';
import { CalendarCheck, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LifecycleBadge, PriorityBadge } from '@/components/badges';
import { Countdown } from '@/components/countdown';
import { AcceptReturnButtons } from '@/components/lead-actions';
import { PhoneActions } from '@/components/phone-actions';
import { Card, CardTitle } from '@/components/ui/card';
import { serviceContext } from '@/lib/services';
import { type CurrentUser, requireUser } from '@/lib/session';

export const metadata = { title: 'Trang chủ' };

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {title}
          {count !== undefined && <span className="ml-2 text-muted-foreground">({count})</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
);

function Kpi({ label, value, hint, emphasis, href }: { label: string; value: string; hint?: string; emphasis?: boolean; href?: string }) {
  const body = (
    <Card data-testid="kpi" className={href ? 'transition-colors hover:bg-muted' : undefined}>
      <CardTitle>{label}</CardTitle>
      <p className={emphasis ? 'mt-1 text-3xl font-bold text-accent-text' : 'mt-1 text-3xl font-bold'}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

async function SalesHome({ user }: { user: CurrentUser }) {
  const d = await salesHome(serviceContext(user));
  const pct = d.target ? Math.round((d.revenue / d.target) * 100) : null;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Lead chờ nhận" value={String(d.pending.length)} emphasis={d.pending.length > 0} />
        <Kpi label="Chưa liên hệ" value={String(d.toContact.length)} href="/leads?status=IN_PROGRESS" />
        <Kpi label="Việc hôm nay" value={String(d.tasks.length)} />
        <Kpi label="Doanh số tháng" value={formatVnd(d.revenue)} hint={pct === null ? 'Chưa đặt chỉ tiêu' : `${pct}% chỉ tiêu ${formatVnd(d.target ?? 0)}`} />
      </div>

      <Section title="Lead chờ bạn nhận" count={d.pending.length}>
        {d.pending.length === 0 ? (
          <Empty>Không có lead nào đang chờ. Lead mới sẽ hiện ở đây ngay khi được chia.</Empty>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2" data-testid="pending-leads">
            {d.pending.map((a) => {
              const c = a.lead.customer;
              return (
                <Card key={a.id} className={a.lead.priority === 'HOT' ? 'border-accent' : undefined}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <Link href={`/leads/${a.lead.id}`} className="font-semibold hover:underline">
                      #{a.lead.code} · {c.contactName}
                    </Link>
                    <PriorityBadge priority={a.lead.priority} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[c.shopName, c.businessModel && BUSINESS_MODEL_LABELS[c.businessModel], c.province].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="mt-1 text-sm">
                    {[c.expectedOrderBand && `Mức nhập ${ORDER_BAND_LABELS[c.expectedOrderBand]}`, c.interestCategories.length && `Quan tâm: ${c.interestCategories.map((x) => INTEREST_CATEGORY_LABELS[x] ?? x).join(', ')}`, `Nguồn: ${LEAD_SOURCE_LABELS[a.lead.source]}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {a.lead.need && <p className="mt-1 line-clamp-2 text-sm italic text-muted-foreground">“{a.lead.need}”</p>}
                  <p className="mt-2 text-sm">
                    {a.acceptDeadline && (
                      <>
                        Nhận trước {formatDateTime(a.acceptDeadline)} · <Countdown deadline={a.acceptDeadline.toISOString()} />
                      </>
                    )}
                  </p>
                  <div className="mt-3">
                    <AcceptReturnButtons leadId={a.lead.id} code={a.lead.code} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Lead đã nhận, chưa liên hệ" count={d.toContact.length}>
        {d.toContact.length === 0 ? (
          <Empty>Bạn đã liên hệ hết các lead đã nhận.</Empty>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {d.toContact.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                  #{l.code} · {l.customer.contactName}
                  {l.customer.shopName && <span className="text-muted-foreground"> · {l.customer.shopName}</span>}
                </Link>
                <span className="flex items-center gap-3 text-sm">
                  <PhoneActions phone={l.customer.phone} compact />
                  {l.firstContactDeadline && (
                    <span className={l.firstContactDeadline < new Date() ? 'font-semibold text-accent-text' : 'text-muted-foreground'}>
                      hạn {formatDateTime(l.firstContactDeadline)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Việc hôm nay" count={d.tasks.length}>
          {d.tasks.length === 0 ? (
            <Empty>Không có việc đến hạn.</Empty>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {d.tasks.map((t) => (
                <li key={t.id} className="px-4 py-3 text-sm">
                  <p className="font-medium">{t.title}</p>
                  <p className={t.dueAt < new Date() ? 'text-accent-text' : 'text-muted-foreground'}>{formatDateTime(t.dueAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Khách cần nhắc tái đặt" count={d.reorder.length}>
          {d.reorder.length === 0 ? (
            <Empty>Chưa có khách đến hạn đặt lại.</Empty>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {d.reorder.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <Link href={`/khach-hang/${c.id}`} className="font-medium hover:underline">
                    {c.shopName ?? c.contactName}
                    {c.province && <span className="text-muted-foreground"> · {c.province}</span>}
                  </Link>
                  <span className="flex items-center gap-2">
                    {c.nextReorderAt && <span className="text-muted-foreground">{formatDate(c.nextReorderAt)}</span>}
                    <LifecycleBadge lifecycle={c.lifecycle} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

async function ManagerHome({ user }: { user: CurrentUser }) {
  const d = await managerHome(serviceContext(user));
  const totalToday = d.bySource.reduce((s, x) => s + x.count, 0);
  const canAct = can(user.role, 'lead.assign');
  return (
    <div className="flex flex-col gap-8">
      {d.holidayReminder && can(user.role, 'settings.manage') && (
        <Link
          href={`/cai-dat/ngay-le?year=${d.holidayReminder.year}`}
          className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          data-testid="holiday-reminder"
        >
          <CalendarCheck className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">
            <strong>Xác nhận lịch nghỉ lễ {d.holidayReminder.year}.</strong> Hệ thống đang dùng {d.holidayReminder.count} ngày theo phương án của khu vực nhà nước để tính thời hạn nhận lead. Kiểm tra lại Tết, ngày liền kề Quốc khánh và 24/11.
          </span>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Lead mới hôm nay" value={String(totalToday)} href="/leads" />
        <Kpi label="Lead chờ giao tay" value={String(d.queued.length)} emphasis={d.queued.length > 0} href="/leads?status=UNASSIGNED" />
        <Kpi label="Quá hạn nhận / liên hệ" value={`${d.overdueAccept} / ${d.overdueContact}`} emphasis={d.overdueAccept + d.overdueContact > 0} href="/leads?slaBreached=true" />
        <Kpi label="Doanh số tháng" value={formatVnd(d.revenue)} hint={`${d.orders} đơn`} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Lead chờ giao tay" count={d.queued.length} action={canAct && d.queued.length > 0 ? <Link className="text-sm font-medium text-primary hover:underline dark:text-brand-green" href="/leads?status=UNASSIGNED">Giao ngay →</Link> : undefined}>
          {d.queued.length === 0 ? (
            <Empty>Không có lead nào trong hàng chờ.</Empty>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {d.queued.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                    #{l.code} · {l.customer.contactName}
                    {l.customer.shopName && <span className="text-muted-foreground"> · {l.customer.shopName}</span>}
                  </Link>
                  <span className="text-muted-foreground">{formatDateTime(l.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Lead hôm nay theo nguồn">
          {d.bySource.length === 0 ? (
            <Empty>Chưa có lead nào hôm nay.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
              {d.bySource
                .sort((a, b) => b.count - a.count)
                .map((s) => (
                  <li key={s.source} className="flex items-center gap-3 text-sm">
                    <span className="w-36 shrink-0">{LEAD_SOURCE_LABELS[s.source]}</span>
                    <span className="h-2.5 flex-1 rounded-full bg-muted">
                      <span className="block h-2.5 rounded-full bg-brand-green" style={{ width: `${Math.max(4, (s.count / totalToday) * 100)}%` }} />
                    </span>
                    <span className="w-8 text-right font-semibold tabular-nums">{s.count}</span>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      </div>
      <p className="text-sm text-muted-foreground">So sánh 3 sales, phễu và báo cáo chi tiết có ở giai đoạn M5.</p>
    </div>
  );
}

async function SupportHome({ user }: { user: CurrentUser }) {
  const scope = { ...scopeFilter(user, 'order'), deletedAt: null };
  const [toDeliver, unpaid] = await Promise.all([
    prisma.order.count({ where: { ...scope, deliveryStatus: { in: ['PENDING', 'PACKING', 'SHIPPING'] } } }),
    prisma.order.count({ where: { ...scope, deliveryStatus: { not: 'CANCELLED' }, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } } }),
  ]);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Kpi label="Đơn đang chờ giao" value={String(toDeliver)} />
      <Kpi label="Đơn chưa thanh toán đủ" value={String(unpaid)} />
    </div>
  );
}

export default async function HomePage() {
  const user = await requireUser();
  const heading = user.role === 'SALES' ? 'Việc của bạn hôm nay' : user.role === 'SUPPORT' ? 'Đơn hàng' : 'Tổng quan kinh doanh';
  return (
    <div>
      <p className="text-sm text-muted-foreground">Xin chào, {user.fullName}</p>
      <h1 className="mb-5 text-2xl font-semibold">{heading}</h1>
      {user.role === 'SALES' ? <SalesHome user={user} /> : user.role === 'SUPPORT' ? <SupportHome user={user} /> : <ManagerHome user={user} />}
    </div>
  );
}
