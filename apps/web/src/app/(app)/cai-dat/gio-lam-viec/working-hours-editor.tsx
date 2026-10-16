'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client';

type Range = [string, string];
interface Day {
  dow: number;
  ranges: Range[];
}

const DAYS = [
  [1, 'Thứ Hai'],
  [2, 'Thứ Ba'],
  [3, 'Thứ Tư'],
  [4, 'Thứ Năm'],
  [5, 'Thứ Sáu'],
  [6, 'Thứ Bảy'],
  [0, 'Chủ nhật'],
] as const;

interface DayState {
  on: boolean;
  morning: Range;
  afternoon: Range | null;
}

function toState(weekly: Day[]): Record<number, DayState> {
  return Object.fromEntries(
    DAYS.map(([dow]) => {
      const d = weekly.find((w) => w.dow === dow);
      const [a, b] = d?.ranges ?? [];
      return [dow, { on: Boolean(a), morning: a ?? ['08:00', '12:00'], afternoon: b ?? (a ? null : ['13:30', '17:30']) }];
    }),
  );
}

/** Two ranges per day (morning / afternoon, lunch break between) — SPEC A1 default 08:00–12:00, 13:30–17:30. */
export function WorkingHoursEditor({ initial }: { initial: Day[] }) {
  const router = useRouter();
  const toast = useToast();
  const [days, setDays] = useState(() => toState(initial));
  const [busy, setBusy] = useState(false);
  const set = (dow: number, patch: Partial<DayState>) => setDays((d) => ({ ...d, [dow]: { ...d[dow]!, ...patch } }));

  async function save() {
    const weekly = DAYS.filter(([dow]) => days[dow]!.on).map(([dow]) => {
      const d = days[dow]!;
      return { dow, ranges: [d.morning, ...(d.afternoon ? [d.afternoon] : [])] };
    });
    setBusy(true);
    try {
      await api('/api/v1/working-calendar', { method: 'PUT', body: { weekly } });
      toast('Đã lưu giờ làm việc');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" data-testid="working-hours">
      {DAYS.map(([dow, label]) => {
        const d = days[dow]!;
        return (
          <div key={dow} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex w-28 items-center gap-2 font-medium">
              <input type="checkbox" className="size-4" checked={d.on} onChange={(e) => set(dow, { on: e.target.checked })} />
              {label}
            </label>
            {d.on ? (
              <>
                <Input type="time" value={d.morning[0]} onChange={(e) => set(dow, { morning: [e.target.value, d.morning[1]] })} className="h-9 w-28" aria-label={`${label} bắt đầu`} />
                <span>–</span>
                <Input type="time" value={d.morning[1]} onChange={(e) => set(dow, { morning: [d.morning[0], e.target.value] })} className="h-9 w-28" aria-label={`${label} nghỉ trưa từ`} />
                {d.afternoon ? (
                  <>
                    <span className="text-muted-foreground">và</span>
                    <Input type="time" value={d.afternoon[0]} onChange={(e) => set(dow, { afternoon: [e.target.value, d.afternoon![1]] })} className="h-9 w-28" aria-label={`${label} làm lại từ`} />
                    <span>–</span>
                    <Input type="time" value={d.afternoon[1]} onChange={(e) => set(dow, { afternoon: [d.afternoon![0], e.target.value] })} className="h-9 w-28" aria-label={`${label} kết thúc`} />
                    <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => set(dow, { afternoon: null })}>
                      bỏ ca chiều
                    </button>
                  </>
                ) : (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => set(dow, { afternoon: ['13:30', '17:30'] })}>
                    + ca chiều
                  </button>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Nghỉ</span>
            )}
          </div>
        );
      })}
      <Button onClick={save} disabled={busy} className="self-start">
        {busy ? 'Đang lưu…' : 'Lưu giờ làm việc'}
      </Button>
    </div>
  );
}
