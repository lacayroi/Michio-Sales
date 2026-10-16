'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/client';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${d}/${m}/${y}`;
};

/** Ngày lễ (SPEC 6.1): Owner chỉnh được + xác nhận lịch của năm. */
export function Holidays({ year, thisYear, confirmed, items }: { year: number; thisYear: number; confirmed: boolean; items: { id: string; date: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, init: { method?: string; body?: unknown }) {
    setBusy(true);
    setError(null);
    const res = await api(url, init);
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message ?? null);
      return false;
    }
    router.refresh();
    return true;
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (await call('/api/v1/holidays', { body: { date: f.get('date'), name: f.get('name') } })) form.reset();
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex items-center gap-3 text-sm">
        <Link href={`/cai-dat?year=${year - 1}#ngay-le`} className="text-primary hover:underline">
          ← {year - 1}
        </Link>
        <Link href={`/cai-dat?year=${year + 1}#ngay-le`} className="text-primary hover:underline">
          {year + 1} →
        </Link>
      </div>
      {confirmed ? (
        <p className="text-sm font-medium text-primary">✓ Đã xác nhận lịch nghỉ năm {year}</p>
      ) : (
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-2.5 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p>
            Tết Âm lịch, ngày nghỉ bù và ngày liền kề Quốc khánh được tạo sẵn theo phương án khu vực nhà nước{year > thisYear ? ' (năm sau có thể chưa được công bố)' : ''}. Kiểm tra lại với lịch nghỉ của công ty rồi xác nhận.
          </p>
          <Button size="sm" className="mt-2" disabled={busy} onClick={() => call('/api/v1/holidays/confirm', { body: { year } })}>
            Xác nhận lịch nghỉ {year}
          </Button>
        </div>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border text-sm" data-testid="holidays">
        {items.length === 0 && <li className="px-3 py-3 text-center text-muted-foreground">Chưa có ngày lễ</li>}
        {items.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span>
              <span className="inline-block w-28 tabular-nums">{fmt(h.date)}</span> {h.name}
            </span>
            <button type="button" onClick={() => call(`/api/v1/holidays/${h.id}`, { method: 'DELETE' })} className="text-xs text-muted-foreground hover:text-accent-text" disabled={busy} aria-label={`Xóa ${h.name} ${h.date}`}>
              Xóa
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input name="date" type="date" required className="h-9 w-40" aria-label="Ngày" />
        <Input name="name" required placeholder="Tên ngày lễ / nghỉ bù" className="h-9 min-w-40 flex-1" aria-label="Tên ngày lễ" />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          Thêm
        </Button>
      </form>
      <FormError message={error} />
    </div>
  );
}
