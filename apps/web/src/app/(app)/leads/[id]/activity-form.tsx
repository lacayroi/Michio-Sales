'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

const TYPES = [
  { value: 'CALL', label: '📞 Cuộc gọi' },
  { value: 'MEETING', label: '🤝 Gặp khách' },
  { value: 'NOTE', label: '📝 Ghi chú' },
] as const;

const RESULTS = [
  { value: 'ANSWERED', label: 'Nghe máy' },
  { value: 'NO_ANSWER', label: 'Không nghe' },
  { value: 'CALL_BACK', label: 'Hẹn gọi lại' },
] as const;

/** Cuộc gọi ghi tay (SPEC 6.9). The first call/meeting is the first contact (FRT). */
export function ActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('CALL');
  const [result, setResult] = useState<(typeof RESULTS)[number]['value']>('ANSWERED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const note = String(new FormData(form).get('note') ?? '').trim();
    if (type === 'NOTE' && !note) return setError('Hãy nhập nội dung ghi chú');
    setBusy(true);
    setError(null);
    const res = await api(`/api/v1/leads/${leadId}/activities`, { body: { type, note: note || null, ...(type === 'CALL' ? { result } : {}) } });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Loại hoạt động">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={type === t.value}
            onClick={() => setType(t.value)}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', type === t.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {type === 'CALL' && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kết quả cuộc gọi">
          {RESULTS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={result === r.value}
              onClick={() => setResult(r.value)}
              className={cn('rounded-lg border px-3 py-1 text-sm', result === r.value ? 'border-primary font-semibold' : 'border-border text-muted-foreground hover:bg-muted')}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      <Textarea name="note" aria-label="Nội dung" placeholder="Nội dung trao đổi…" />
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? 'Đang lưu…' : 'Lưu hoạt động'}
      </Button>
    </form>
  );
}
