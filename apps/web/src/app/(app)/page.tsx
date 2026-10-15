import { can, scopeFilter } from '@michio/auth';
import { prisma } from '@michio/db';
import { formatVnd, vnDayRange, vnMonthRange } from '@michio/shared';
import { Card, CardTitle } from '@/components/ui/card';
import { type CurrentUser, requireUser } from '@/lib/session';

export const metadata = { title: 'Trang chủ' };

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}

async function salesKpis(user: CurrentUser): Promise<Kpi[]> {
  const today = vnDayRange();
  const month = vnMonthRange();
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const [pending, tasksToday, reorder, revenue, target] = await Promise.all([
    prisma.leadAssignment.count({ where: { userId: user.id, status: 'PENDING' } }),
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
  const [newLeads, pending, revenue, atRisk] = await Promise.all([
    prisma.lead.count({ where: { ...scopeFilter(user, 'lead'), deletedAt: null, createdAt: { gte: today.start, lt: today.end } } }),
    prisma.lead.count({ where: { ...scopeFilter(user, 'lead'), deletedAt: null, status: { in: ['NEW', 'UNASSIGNED', 'ASSIGNED'] } } }),
    prisma.order.aggregate({
      _sum: { total: true },
      _count: true,
      where: { orgId: user.orgId, deletedAt: null, deliveryStatus: { not: 'CANCELLED' }, orderedAt: { gte: month.start, lt: month.end } },
    }),
    prisma.customer.count({ where: { ...scopeFilter(user, 'customer'), deletedAt: null, lifecycle: { in: ['AT_RISK', 'DORMANT'] } } }),
  ]);
  return [
    { label: 'Lead mới hôm nay', value: String(newLeads) },
    { label: 'Lead chưa được nhận', value: String(pending), emphasis: pending > 0 },
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

export default async function HomePage() {
  const user = await requireUser();
  const kpis =
    user.role === 'SALES' ? await salesKpis(user) : user.role === 'SUPPORT' ? await supportKpis(user) : await ownerKpis(user);
  const heading = user.role === 'SALES' ? 'Việc của bạn hôm nay' : user.role === 'SUPPORT' ? 'Đơn hàng' : 'Tổng quan kinh doanh';

  return (
    <section>
      <p className="text-sm text-muted-foreground">Xin chào, {user.fullName}</p>
      <h1 className="mb-5 text-2xl font-semibold">{heading}</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} data-testid="kpi">
            <CardTitle>{k.label}</CardTitle>
            <p className={k.emphasis ? 'mt-1 text-3xl font-bold text-accent-text' : 'mt-1 text-3xl font-bold'}>{k.value}</p>
            {k.hint && <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>}
          </Card>
        ))}
      </div>
      {can(user.role, 'report.view') && user.role !== 'SALES' && (
        <p className="mt-6 text-sm text-muted-foreground">Dashboard đầy đủ (so sánh sales, phễu, nguồn lead) có ở giai đoạn M5.</p>
      )}
    </section>
  );
}
