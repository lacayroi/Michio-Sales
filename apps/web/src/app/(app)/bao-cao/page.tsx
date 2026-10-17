import { authorize, can } from '@michio/auth';
import { getReport, listTargets, listUsers, REPORT_NAMES, REPORT_TITLES, type ReportName } from '@michio/core';
import { BUSINESS_MODEL_LABELS, formatVnd, LEAD_SOURCE_LABELS, vnMonthRange } from '@michio/shared';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { ColumnChart } from '@/components/column-chart';
import { ReportGrid, SummaryTiles } from '@/components/report-table';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';
import { TargetsEditor } from './targets';

export const metadata = { title: 'Báo cáo' };

type SP = Record<string, string | undefined>;
const DAY = 86_400_000;
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** S12 — Tổng quan, Nguồn, Phễu, Sales, Doanh số, Khách, Sản phẩm, Lý do thua, Tốc độ phản hồi, Chỉ tiêu. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('report.view', 'report.orders');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const full = can(user.role, 'report.view');
  const tabs: (ReportName | 'targets')[] = full ? [...REPORT_NAMES, 'targets'] : ['revenue', 'products'];
  const tab = (tabs.includes(sp.tab as ReportName) ? sp.tab : tabs[0]) as ReportName | 'targets';

  // Period: whole Vietnam days from the date inputs; default = this month.
  const month = vnMonthRange(new Date());
  const fromDay = sp.from ?? ymd(month.start);
  const toDay = sp.to ?? ymd(new Date(month.end.getTime() - DAY));
  const from = new Date(`${fromDay}T00:00:00+07:00`);
  const to = new Date(new Date(`${toDay}T00:00:00+07:00`).getTime() + DAY);
  const filters = { from: from.toISOString(), to: to.toISOString(), ownerId: sp.ownerId || undefined, source: sp.source || undefined, businessModel: sp.businessModel || undefined, province: sp.province || undefined, groupBy: sp.groupBy || undefined };
  const users = can(user.role, 'lead.assign') || user.role === 'VIEWER' ? await listUsers(ctx).catch(() => []) : [];
  const sales = users.filter((u) => u.role === 'SALES' || u.role === 'OWNER' || u.role === 'MANAGER');

  const report = tab === 'targets' ? null : await getReport(ctx, tab, filters as never);
  const targets = tab === 'targets' ? await listTargets(ctx, sp.month) : null;
  const canExport = authorize(user, 'export.reports') || (authorize(user, 'export.orders') && (tab === 'revenue' || tab === 'products'));
  const qs = (over: SP) => `/bao-cao?${new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][])}`;
  const exportQs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Báo cáo</h1>
      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:px-0" aria-label="Loại báo cáo">
        {tabs.map((t) => (
          <Link key={t} href={qs({ tab: t })} aria-current={tab === t ? 'page' : undefined}
            className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium', tab === t ? 'border-brand-green' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'targets' ? 'Chỉ tiêu' : REPORT_TITLES[t]}
          </Link>
        ))}
      </nav>

      {tab !== 'targets' && report && (
        <>
          <form className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3" aria-label="Bộ lọc báo cáo">
            <input type="hidden" name="tab" value={tab} />
            <label className="text-xs">Từ<Input type="date" name="from" defaultValue={fromDay} className="h-10 w-40" /></label>
            <label className="text-xs">Đến<Input type="date" name="to" defaultValue={toDay} className="h-10 w-40" /></label>
            {sales.length > 0 && (
              <label className="text-xs">Sales<Select name="ownerId" defaultValue={sp.ownerId ?? ''} className="w-44"><option value="">Tất cả</option>{sales.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></label>
            )}
            {full && (
              <>
                <label className="text-xs">Nguồn<Select name="source" defaultValue={sp.source ?? ''} className="w-44"><option value="">Mọi nguồn</option>{Object.entries(LEAD_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
                <label className="text-xs">Mô hình<Select name="businessModel" defaultValue={sp.businessModel ?? ''} className="w-48"><option value="">Mọi mô hình</option>{Object.entries(BUSINESS_MODEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
                <label className="text-xs">Tỉnh<Input name="province" defaultValue={sp.province} className="h-10 w-32" /></label>
              </>
            )}
            {tab === 'revenue' && (
              <label className="text-xs">Theo<Select name="groupBy" defaultValue={sp.groupBy ?? ''} className="w-28"><option value="">Tự động</option><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option></Select></label>
            )}
            {tab === 'funnel' && (
              <label className="text-xs">Theo<Select name="groupBy" defaultValue={sp.groupBy ?? 'source'} className="w-40"><option value="source">Nguồn</option><option value="businessModel">Mô hình kinh doanh</option><option value="orderBand">Mức nhập</option></Select></label>
            )}
            <button type="submit" className={buttonVariants({ variant: 'outline' })}>Xem</button>
            {canExport && <a href={`/api/v1/reports/${tab}/export?${exportQs}`} className={buttonVariants({ variant: 'outline', className: 'ml-auto' })}><Download className="size-4" />Xuất Excel</a>}
          </form>
          {user.role === 'SALES' && <p className="text-sm text-muted-foreground">Số liệu của riêng bạn.</p>}
          <SummaryTiles summary={report.summary} />
          {tab === 'revenue' && report.rows.length > 1 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Doanh số theo {String(report.columns[0]!.label).toLowerCase()}</h2>
              <ColumnChart
                title="Doanh số"
                valueType="money"
                data={report.rows.map((r) => ({ label: String(r.period), tick: String(r.period).slice(-2), value: Number(r.revenue), detail: [`${r.orders} đơn`, `Khách mới ${formatVnd(Number(r.revenueNew))}`] }))}
              />
            </div>
          )}
          <ReportGrid report={report} />
        </>
      )}

      {targets && <TargetsEditor month={targets.month} rows={targets.rows} canEdit={can(user.role, 'target.manage')} />}
    </section>
  );
}
