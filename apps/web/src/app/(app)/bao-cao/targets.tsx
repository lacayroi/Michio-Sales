'use client';

import { formatVnd } from '@michio/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

interface Row {
  userId: string;
  fullName: string;
  target: { revenue: number; newCustomers: number | null; orders: number | null } | null;
  actual: { revenue: number; orders: number; newCustomers: number };
}

/** Chỉ tiêu tháng (SPEC 6.11): Owner/Manager đặt doanh số, khách mới, số đơn cho từng sales; kèm thực đạt. */
export function TargetsEditor({ month, rows, canEdit }: { month: string; rows: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [edit, setEdit] = useState(() => Object.fromEntries(rows.map((r) => [r.userId, { revenue: String(r.target?.revenue ?? ''), newCustomers: String(r.target?.newCustomers ?? ''), orders: String(r.target?.orders ?? '') }])));
  async function save() {
    try {
      await api('/api/v1/targets', {
        method: 'PUT',
        body: {
          month,
          rows: Object.entries(edit).filter(([, v]) => v.revenue !== '').map(([userId, v]) => ({ userId, revenue: Number(v.revenue), newCustomers: v.newCustomers === '' ? null : Number(v.newCustomers), orders: v.orders === '' ? null : Number(v.orders) })),
        },
      });
      toast('Đã lưu chỉ tiêu');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    }
  }
  const pct = (a: number, t: number | null | undefined) => (t ? `${Math.round((a / t) * 100)}%` : '—');
  return (
    <div className="flex flex-col gap-3">
      <form className="flex items-end gap-2" action="/bao-cao">
        <input type="hidden" name="tab" value="targets" />
        <label className="text-xs">Tháng<Input type="month" name="month" defaultValue={month} className="h-10 w-44" /></label>
        <button type="submit" className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Xem</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm" data-testid="targets-table">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Sales</th><th className="p-3">Chỉ tiêu doanh số</th><th className="p-3 text-right">Thực đạt</th><th className="p-3 text-right">%</th><th className="p-3">Khách mới (CT / đạt)</th><th className="p-3">Số đơn (CT / đạt)</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const e = edit[r.userId]!;
              const set = (k: keyof typeof e) => (ev: React.ChangeEvent<HTMLInputElement>) => setEdit((x) => ({ ...x, [r.userId]: { ...x[r.userId]!, [k]: ev.target.value } }));
              return (
                <tr key={r.userId}>
                  <td className="p-3 font-medium">{r.fullName}</td>
                  <td className="p-3">{canEdit ? <Input type="number" min={0} step={1_000_000} value={e.revenue} onChange={set('revenue')} className="h-9 w-40" aria-label={`Chỉ tiêu ${r.fullName}`} /> : r.target ? formatVnd(r.target.revenue) : '—'}</td>
                  <td className="p-3 text-right tabular-nums">{formatVnd(r.actual.revenue)}</td>
                  <td className="p-3 text-right tabular-nums">{pct(r.actual.revenue, r.target?.revenue)}</td>
                  <td className="p-3"><span className="flex items-center gap-2">{canEdit ? <Input type="number" min={0} value={e.newCustomers} onChange={set('newCustomers')} className="h-9 w-20" aria-label={`Khách mới ${r.fullName}`} /> : (r.target?.newCustomers ?? '—')} / {r.actual.newCustomers}</span></td>
                  <td className="p-3"><span className="flex items-center gap-2">{canEdit ? <Input type="number" min={0} value={e.orders} onChange={set('orders')} className="h-9 w-20" aria-label={`Số đơn ${r.fullName}`} /> : (r.target?.orders ?? '—')} / {r.actual.orders}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && <div className="flex justify-end"><Button onClick={save}>Lưu chỉ tiêu tháng {month}</Button></div>}
    </div>
  );
}
