'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

type Values = Record<string, boolean | number>;

const TOGGLES: [string, string, string][] = [
  ['automation.quoteFollowUp', 'Follow-up báo giá', 'Gửi báo giá → tạo việc "Follow-up báo giá" sau N ngày làm việc'],
  ['automation.reorderReminder', 'Nhắc tái đặt hàng', 'Hằng ngày 07:30 (T2–T7) tạo việc cho sales trước ngày khách thường đặt lại'],
  ['automation.staleLead', 'Cảnh báo lead im lặng', 'Lead đang xử lý không có hoạt động quá N ngày → báo sales'],
];

const NUMBERS: [string, string, number, number][] = [
  ['quote.validDays', 'Hiệu lực báo giá (ngày)', 1, 90],
  ['quote.followUpBusinessDays', 'Follow-up báo giá sau (ngày làm việc)', 1, 30],
  ['quote.maxExtraDiscountPct', 'Sales được giảm thêm tối đa (%)', 0, 100],
  ['reorder.defaultCycleDays', 'Chu kỳ tái đặt mặc định (ngày)', 7, 120],
  ['reorder.remindBeforeDays', 'Nhắc trước ngày đặt lại (ngày)', 0, 30],
  ['reorder.dormantDays', 'Ngủ đông sau (ngày không đặt)', 30, 365],
  ['lead.staleDays', 'Lead im lặng sau (ngày)', 1, 60],
];

export function AutomationForm({ values }: { values: Values }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState(values);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      for (const [k, val] of Object.entries(v)) if (val !== values[k]) await api(`/api/v1/settings/${k}`, { method: 'PUT', body: { value: val } });
      toast('Đã lưu');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        {TOGGLES.map(([k, label, hint]) => (
          <label key={k} className="flex items-start gap-3">
            <input type="checkbox" checked={Boolean(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.checked })} className="mt-1 size-4 accent-[var(--primary)]" />
            <span><span className="font-medium">{label}</span><span className="block text-sm text-muted-foreground">{hint}</span></span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
        {NUMBERS.map(([k, label, min, max]) => (
          <label key={k} className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{label}</span>
            <Input type="number" min={min} max={max} value={Number(v[k])} onChange={(e) => setV({ ...v, [k]: Math.min(max, Math.max(min, Number(e.target.value) || 0)) })} />
          </label>
        ))}
      </div>
      <div className="flex justify-end"><Button onClick={save} disabled={busy}>Lưu</Button></div>
    </div>
  );
}
