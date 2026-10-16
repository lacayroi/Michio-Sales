'use client';

import { BUSINESS_MODEL_LABELS, formatDateTime, LEAD_SOURCE_LABELS, ORDER_BAND_LABELS } from '@michio/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface Result {
  path: string;
  explanation: string;
  matchedRules: { id: string; name: string }[];
  candidates: { id: string; fullName: string; openLeads: number; maxOpenLeads: number; eligible: boolean; reason: string | null }[];
  picked: { id: string; fullName: string } | null;
  acceptDeadline: string | null;
}

/** "Thử luật": nhập lead giả để xem ai nhận — không thay đổi lượt xoay vòng (SPEC 6.12). */
export function Simulator() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '') || null;
    setBusy(true);
    setError(null);
    const res = await api<Result>('/api/v1/assignment-rules/simulate', {
      body: { source: v('source'), businessModel: v('businessModel'), expectedOrderBand: v('expectedOrderBand'), province: v('province'), phone: v('phone') },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    setResult(res.data);
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="Nguồn" htmlFor="sim-source">
          <Select id="sim-source" name="source" defaultValue="WEBSITE_WHOLESALE_FORM">
            {Object.entries(LEAD_SOURCE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mức nhập" htmlFor="sim-band">
          <Select id="sim-band" name="expectedOrderBand" defaultValue="">
            <option value="">—</option>
            {Object.entries(ORDER_BAND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mô hình" htmlFor="sim-bm">
          <Select id="sim-bm" name="businessModel" defaultValue="">
            <option value="">—</option>
            {Object.entries(BUSINESS_MODEL_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tỉnh/thành" htmlFor="sim-province">
          <Input id="sim-province" name="province" />
        </Field>
        <Field label="SĐT (để thử khách cũ)" htmlFor="sim-phone" className="col-span-2">
          <Input id="sim-phone" name="phone" type="tel" />
        </Field>
        <Button type="submit" variant="outline" disabled={busy} className="col-span-2 sm:col-span-1">
          Thử
        </Button>
      </form>
      <FormError message={error} />
      {result && (
        <div className="rounded-xl bg-muted/60 p-3 text-sm" role="status" data-testid="simulation">
          <p className="font-semibold">{result.explanation}</p>
          {result.acceptDeadline && <p className="text-muted-foreground">Hạn nhận nếu tạo bây giờ: {formatDateTime(new Date(result.acceptDeadline))}</p>}
          {result.matchedRules.length > 0 && <p className="text-muted-foreground">Luật khớp: {result.matchedRules.map((r) => r.name).join(' → ')}</p>}
          {result.candidates.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {result.candidates.map((c) => (
                <li key={c.id} className={cn('flex justify-between gap-2', c.id === result.picked?.id && 'font-semibold text-primary')}>
                  <span>
                    {c.id === result.picked?.id ? '➜ ' : ''}
                    {c.fullName}
                  </span>
                  <span className={c.eligible ? 'text-muted-foreground' : 'text-accent-text'}>
                    {c.eligible ? `${c.openLeads}/${c.maxOpenLeads} lead mở` : c.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
