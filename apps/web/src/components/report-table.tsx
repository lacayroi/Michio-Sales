import type { ReportTable } from '@michio/core';
import { formatVnd } from '@michio/shared';

type Cell = string | number | null | undefined;

export function formatCell(v: Cell, type: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  switch (type) {
    case 'money':
      return formatVnd(v);
    case 'percent':
      return `${v.toLocaleString('vi-VN')}%`;
    case 'minutes':
      return v >= 60 ? `${Math.floor(v / 60)} giờ ${Math.round(v % 60)} phút` : `${Math.round(v)} phút`;
    default:
      return v.toLocaleString('vi-VN');
  }
}

/** Stat tiles: label · value (no colored text; color carries no meaning here). */
export function SummaryTiles({ summary }: { summary: ReportTable['summary'] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="report-summary">
      {summary.map((s) => (
        <div key={s.label} className="rounded-xl border border-border bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{formatCell(s.value, s.type)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportGrid({ report }: { report: Pick<ReportTable, 'columns' | 'rows' | 'title'> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[560px] text-sm" data-testid="report-table">
        <caption className="sr-only">{report.title}</caption>
        <thead className="border-b border-border text-left text-xs text-muted-foreground">
          <tr>{report.columns.map((c) => <th key={c.key} className={`p-3 ${c.type === 'text' ? '' : 'text-right'}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {report.rows.length === 0 && <tr><td colSpan={report.columns.length} className="p-6 text-center text-muted-foreground">Không có dữ liệu trong khoảng thời gian này</td></tr>}
          {report.rows.map((r, i) => (
            <tr key={i} className={r[report.columns[0]!.key] === 'Tổng' ? 'font-semibold' : ''}>
              {report.columns.map((c) => <td key={c.key} className={`p-3 ${c.type === 'text' ? '' : 'text-right tabular-nums'}`}>{formatCell(r[c.key], c.type)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
