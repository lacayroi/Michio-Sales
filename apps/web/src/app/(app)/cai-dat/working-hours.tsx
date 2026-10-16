'use client';

import type { WeeklyHours } from '@michio/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/client';

const DAYS = [
  [1, 'Thứ 2'],
  [2, 'Thứ 3'],
  [3, 'Thứ 4'],
  [4, 'Thứ 5'],
  [5, 'Thứ 6'],
  [6, 'Thứ 7'],
  [0, 'Chủ nhật'],
] as const;

interface DayState {
  on: boolean;
  morning: [string, string];
  afternoon: [string, string] | null;
}

function toState(weekly: WeeklyHours[]): Record<number, DayState> {
  return Object.fromEntries(
    DAYS.map(([dow]) => {
      const d = weekly.find((w) => w.dow === dow);
      const [a, b] = d?.ranges ?? [];
      return [dow, { on: !!a, morning: a ?? ['08:00', '12:00'], afternoon: b ?? (a ? null : ['13:30', '17:30']) }];
    }),
  );
}

/** T2–T7 08:00–12:00 / 13:30–17:30 by default (SPEC A1); two ranges per day (lunch break). */
export function WorkingHours({ initial }: { initial: WeeklyHours[] }) {
  const router = useRouter();
  const [days, setDays] = useState(() => toState(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (dow: number, patch: Partial<DayState>) => setDays((d) => ({ ...d, [dow]: { ...d[dow]!, ...patch } }));

  async function save() {
    const weekly = DAYS.filter(([dow]) => days[dow]!.on).map(([dow]) => {
      const d = days[dow]!;
      return { dow, ranges: [d.morning, ...(d.afternoon ? [d.afternoon] : [])] };
    });
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await api('/api/v1/working-calendar', { method: 'PUT', body: { weekly } });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {DAYS.map(([dow, label]) => {
        const d = days[dow]!;
        return (
          <div key={dow} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex w-24 items-center gap-2 font-medium">
              <input type="checkbox" checked={d.on} onChange={(e) => set(dow, { on: e.target.checked })} className="size-4" />
              {label}
            </label>
            {d.on ? (
              <>
                <Input type="time" value={d.morning[0]} onChange={(e) => set(dow, { morning: [e.target.value, d.morning[1]] })} className="h-9 w-28" aria-label={`${label} bắt đầu sáng`} />
                –
                <Input type="time" value={d.morning[1]} onChange={(e) => set(dow, { morning: [d.morning[0], e.target.value] })} className="h-9 w-28" aria-label={`${label} kết thúc sáng`} />
                {d.afternoon ? (
                  <>
                    <span className="text-muted-foreground">,</span>
                    <Input type="time" value={d.afternoon[0]} onChange={(e) => set(dow, { afternoon: [e.target.value, d.afternoon![1]] })} className="h-9 w-28" aria-label={`${label} bắt đầu chiều`} />
                    –
                    <Input type="time" value={d.afternoon[1]} onChange={(e) => set(dow, { afternoon: [d.afternoon![0], e.target.value] })} className="h-9 w-28" aria-label={`${label} kết thúc chiều`} />
                    <button type="button" onClick={() => set(dow, { afternoon: null })} className="text-xs text-muted-foreground hover:underline">
                      bỏ ca chiều
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => set(dow, { afternoon: ['13:30', '17:30'] })} className="text-xs text-primary hover:underline">
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
      <FormError message={error} />
      {saved && (
        <p role="status" className="text-sm font-medium text-primary">
          Đã lưu
        </p>
      )}
      <Button onClick={save} disabled={busy} className="self-start">
        Lưu giờ làm việc
      </Button>
    </div>
  );
}
