import { can, scopeFilter } from '@michio/auth';
import { holidayYearNeedsConfirmation, pendingLeadsFor, slaBreachedWhere } from '@michio/core';
import { prisma } from '@michio/db';
import { formatDate, formatDateTime, formatVnd, ORDER_BAND_LABELS, vnDayRange, vnMonthRange } from '@michio/shared';
import Link from 'next/link';
import { Countdown } from '@/components/countdown';
import { categoryLabel } from '@/components/customer-profile';
import { PriorityBadge } from '@/components/lead-badges';
import { PhoneLinks } from '@/components/phone-links';
import { Card, CardTitle } from '@/components/ui/card';
import { type CurrentUser, requireUser } from '@/lib/session';
import { LeadActions } from './leads/[id]/lead-actions';

export const metadata = { title: 'Trang chủ' };

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  href?: string;
}

async function salesKpis(user: CurrentUser): Promise<Kpi[]> {
  const today = vnDayRange();
  const month = vnMonthRange();
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const [pending, tasksToday, reorder, revenue, target] = await Promise.all([
    prisma.leadAssignment.count({ where: { userId: user.id, status: 'PENDING', lead: { deletedAt: null } } }),
    prisma.task.count({ where: { ...scopeFilter(user, 'task'), status: 'TODO', dueAt: { lt: today.end } } }),
    prisma.customer.count({
      where: {
        ...scopeFilter(user, 'customer'),
        deletedAt: null,
        OR: [{ nextReorderAt: { lte: soon } }, { lifecycle: 'AT_RISK' }],
      },
    }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: { ...scopeFilter(user, 'order'), deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { gte: month.start, lt: month.end } },
    }),
    prisma.target.findUnique({ where: { userId_month: { userId: user.id, month: month.key } } }),
  ]);
  const rev = Number(revenue._sum.total ?? 0);
  const pct = target && Number(target.revenue) > 0 ? Math.round((rev / Number(target.revenue)) * 100) : null;
  return [
    { label: 'Lead chờ nhận', value: String(pending), emphasis: pending > 0 },
    { label: 'Việc hôm nay (gồm quá hạn)', value: String(tasksToday) },
    { label: 'Khách cần nhắc tái đặt', value: String(reorder) },
    { label: 'Doanh số tháng', value: formatVnd(rev), hint: pct === null ? 'Chưa đặt chỉ tiêu' : `${pct}% chỉ tiêu` },
  ];
}

async function ownerKpis(user: CurrentUser): Promise<Kpi[]> {
  const today = vnDayRange();
  const month = vnMonthRange();
  const leadScope = { ...scopeFilter(user, 'lead'), deletedAt: null };
  const [newLeads, queued, overdue, revenue, atRisk] = await Promise.all([
    prisma.lead.count({ where: { ...leadScope, createdAt: { gte: today.start, lt: today.end } } }),
    prisma.lead.count({ where: { ...leadScope, status: { in: ['NEW', 'UNASSIGNED'] } } }),
    prisma.lead.count({ where: { AND: [leadScope, slaBreachedWhere(new Date())] } }),
    prisma.order.aggregate({
      _sum: { total: true },
      _count: true,
      where: { orgId: user.orgId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { gte: month.start, lt: month.end } },
    }),
    prisma.customer.count({ where: { ...scopeFilter(user, 'customer'), deletedAt: null, lifecycle: { in: ['AT_RISK', 'DORMANT'] } } }),
  ]);
  return [
    { label: 'Lead mới hôm nay', value: String(newLeads), href: '/leads?tab=all' },
    { label: 'Lead chờ giao', value: String(queued), emphasis: queued > 0, href: '/leads?tab=queue' },
    { label: 'Lead quá hạn', value: String(overdue), emphasis: overdue > 0, href: '/leads?tab=overdue' },
    { label: 'Doanh số tháng', value: formatVnd(Number(revenue._sum.total ?? 0)), hint: `${revenue._count} đơn` },
    { label: 'Khách có nguy cơ / ngủ đông', value: String(atRisk) },
  ];
}

async function supportKpis(user: CurrentUser): Promise<Kpi[]> {
  const scope = { ...scopeFilter(user, 'order'), deletedAt: null };
  const [toDeliver, unpaid] = await Promise.all([
    prisma.order.count({ where: { ...scope, deliveryStatus: { in: ['PENDING', 'PACKING', 'SHIPPING'] } } }),
    prisma.order.count({ where: { ...scope, deliveryStatus: { not: 'CANCELLED' }, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } } }),
  ]);
  return [
    { label: 'Đơn đang chờ giao', value: String(toDeliver) },
    { label: 'Đơn chưa thanh toán đủ', value: String(unpaid) },
  ];
}

/** S2: lead chờ nhận (đếm ngược, nút Nhận/Trả lớn), việc hôm nay, khách cần nhắc tái đặt. */
async function SalesBoard({ user }: { user: CurrentUser }) {
  const today = vnDayRange();
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const [pending, tasks, reorder] = await Promise.all([
    pendingLeadsFor(prisma, user.id),
    prisma.task.findMany({
      where: { ...scopeFilter(user, 'task'), status: 'TODO', dueAt: { lt: today.end } },
      orderBy: { dueAt: 'asc' },
      take: 10,
      include: { customer: { select: { id: true, contactName: true, shopName: true } } },
    }),
    prisma.customer.findMany({
      where: { ...scopeFilter(user, 'customer'), deletedAt: null, OR: [{ nextReorderAt: { lte: soon } }, { lifecycle: 'AT_RISK' }] },
      orderBy: { nextReorderAt: 'asc' },
      take: 5,
      select: { id: true, contactName: true, shopName: true, province: true, nextReorderAt: true, lifecycle: true, phone: true },
    }),
  ]);

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2" data-testid="pending-leads">
        <CardTitle>Lead chờ bạn nhận</CardTitle>
        {pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Không có lead nào đang chờ. Lead mới sẽ hiện ở đây ngay khi được giao.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {pending.map((a) => {
              const c = a.lead.customer;
              return (
                <li key={a.id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${a.leadId}`} className="font-semibold hover:underline">
                      #{a.lead.code} · {c.contactName}
                    </Link>
                    <PriorityBadge priority={a.lead.priority} />
                    {a.acceptDeadline && <Countdown deadline={a.acceptDeadline.toISOString()} className="ml-auto text-sm" />}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[c.shopName, c.province, c.expectedOrderBand && c.expectedOrderBand !== 'UNKNOWN' ? `Mức nhập ${ORDER_BAND_LABELS[c.expectedOrderBand]}` : null, c.interestCategories.length ? `Quan tâm: ${c.interestCategories.map(categoryLabel).join(', ')}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {a.lead.need && <p className="mt-1 line-clamp-2 text-sm">{a.lead.need}</p>}
                  <div className="mt-2">
                    <LeadActions leadId={a.leadId} canAccept canReturn assignees={null} lostReasons={null} canDelete={false} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Việc hôm nay</CardTitle>
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Không có việc đến hạn</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {tasks.map((t) => (
              <li key={t.id} className="py-2 text-sm">
                <p className="font-medium">{t.title}</p>
                <p className={`text-xs ${t.dueAt < new Date() ? 'font-semibold text-accent-text' : 'text-muted-foreground'}`}>
                  {formatDateTime(t.dueAt)}
                  {t.customer && (
                    <>
                      {' · '}
                      <Link href={`/khach-hang/${t.customer.id}`} className="hover:underline">
                        {t.customer.shopName ?? t.customer.contactName}
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Khách cần nhắc tái đặt</CardTitle>
        {reorder.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chưa có khách đến hạn</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {reorder.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <Link href={`/khach-hang/${c.id}`} className="font-medium hover:underline">
                  {c.shopName ?? c.contactName}
                </Link>
                <span className="text-muted-foreground"> · {c.province ?? ''}</span>
                <p className="text-xs text-muted-foreground">{c.nextReorderAt ? `Hẹn đặt lại ${formatDate(c.nextReorderAt)}` : 'Có nguy cơ rời bỏ'}</p>
                <PhoneLinks phone={c.phone} compact />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default async function HomePage() {
  const user = await requireUser();
  const kpis =
    user.role === 'SALES' ? await salesKpis(user) : user.role === 'SUPPORT' ? await supportKpis(user) : await ownerKpis(user);
  const heading = user.role === 'SALES' ? 'Việc của bạn hôm nay' : user.role === 'SUPPORT' ? 'Đơn hàng' : 'Tổng quan kinh doanh';
  const year = new Date().getFullYear();
  const remindHolidays = can(user.role, 'settings.manage') && (await holidayYearNeedsConfirmation(prisma, user.orgId, year));

  return (
    <section>
      <p className="text-sm text-muted-foreground">Xin chào, {user.fullName}</p>
      <h1 className="mb-5 text-2xl font-semibold">{heading}</h1>
      {remindHolidays && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="note">
          <span>Lịch nghỉ lễ năm {year} (Tết, ngày nghỉ bù, Quốc khánh) đang theo phương án khu vực nhà nước — hãy kiểm tra và xác nhận để hạn SLA tính đúng.</span>
          <Link href="/cai-dat#ngay-le" className="font-semibold underline">
            Kiểm tra lịch nghỉ
          </Link>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => {
          const body = (
            <>
              <CardTitle>{k.label}</CardTitle>
              <p className={k.emphasis ? 'mt-1 text-3xl font-bold text-accent-text' : 'mt-1 text-3xl font-bold'}>{k.value}</p>
              {k.hint && <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>}
            </>
          );
          return (
            <Card key={k.label} data-testid="kpi" className={k.href ? 'p-0' : undefined}>
              {k.href ? (
                <Link href={k.href} className="block rounded-xl p-4 hover:bg-muted/50">
                  {body}
                </Link>
              ) : (
                body
              )}
            </Card>
          );
        })}
      </div>
      {user.role === 'SALES' && <SalesBoard user={user} />}
      {can(user.role, 'report.view') && user.role !== 'SALES' && (
        <p className="mt-6 text-sm text-muted-foreground">Dashboard đầy đủ (so sánh sales, phễu, nguồn lead) có ở giai đoạn M5.</p>
      )}
    </section>
  );
}
