'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

const DOW = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

export function HolidayEditor({ year, items, confirmed }: { year: number; items: { id: string; date: string; name: string }[]; confirmed: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thao tác thất bại', 'error');
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void call(async () => {
      await api('/api/v1/holidays', { body: { date: String(f.get('date')), name: String(f.get('name')) } });
      form.reset();
    }, 'Đã thêm ngày nghỉ');
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface" data-testid="holidays">
        {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có ngày lễ nào cho năm {year}.</li>}
        {items.map((h) => {
          const [y, m, d] = h.date.split('-');
          const dow = new Date(`${h.date}T00:00:00Z`).getUTCDay();
          return (
            <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>
                <span className="inline-block w-36 tabular-nums">{d}/{m}/{y} · {DOW[dow]}</span>
                {h.name}
              </span>
              <Button size="sm" variant="ghost" aria-label={`Xóa ${h.name} ${d}/${m}`} disabled={busy} onClick={() => call(() => api(`/api/v1/holidays/${h.id}`, { method: 'DELETE' }), 'Đã xóa')}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add} className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3">
        <Input type="date" name="date" required min={`${year}-01-01`} max={`${year}-12-31`} className="w-auto" aria-label="Ngày" />
        <Input name="name" required placeholder="Tên ngày nghỉ" className="min-w-40 flex-1" aria-label="Tên ngày nghỉ" />
        <Button type="submit" variant="outline" disabled={busy}>Thêm</Button>
      </form>
      {confirmed ? (
        <p className="text-sm font-medium text-primary dark:text-brand-green">✓ Đã xác nhận lịch nghỉ lễ {year}.</p>
      ) : (
        <div>
          <Button disabled={busy} onClick={() => call(() => api('/api/v1/holidays/confirm', { body: { year } }), `Đã xác nhận lịch nghỉ lễ ${year}`)}>
            Xác nhận lịch nghỉ lễ {year}
          </Button>
        </div>
      )}
    </div>
  );
}
