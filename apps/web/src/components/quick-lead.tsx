'use client';

import { LEAD_SOURCE_LABELS } from '@michio/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, fieldErrors } from '@/lib/client';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Field, FormError } from './ui/field';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';

const QUICK_SOURCES = ['ZALO_COMPANY', 'HOTLINE', 'FACEBOOK_MESSENGER', 'REFERRAL', 'MANUAL', 'OTHER'] as const;

interface Result {
  leadId: string;
  code: number;
  duplicate: boolean;
  assignedTo: { fullName: string } | null;
}

/**
 * "+ Lead nhanh" (SPEC 5.3 chế độ A, S4): SĐT + tên + ghi chú. Always visible, a floating button on phones.
 * SALES keep the lead by default (§3) and may hand it to the rotation instead (người trực Zalo).
 */
export function QuickLeadButton({ isSales }: { isSales: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);

  function close() {
    setOpen(false);
    setResult(null);
    setError(null);
    setErrors({});
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const f = new FormData(e.currentTarget);
    const res = await api<Result>('/api/v1/leads/quick', {
      body: {
        phone: f.get('phone'),
        name: f.get('name'),
        note: f.get('note') || null,
        source: f.get('source'),
        ...(isSales ? { assign: f.get('rotate') ? 'auto' : 'self' } : {}),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message ?? null);
      setErrors(fieldErrors(res.error));
      return;
    }
    setResult(res.data);
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} className="hidden sm:inline-flex">
        <Plus className="size-4" /> Lead nhanh
      </Button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Lead nhanh"
        className="fixed right-4 bottom-5 z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg sm:hidden"
      >
        <Plus className="size-7" />
      </button>

      <Dialog open={open} onClose={close} title="Lead nhanh">
        {result ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-base font-semibold">
              {result.duplicate ? `Khách đã có lead đang mở #${result.code}` : `Đã tạo lead #${result.code}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {result.assignedTo ? `Người phụ trách: ${result.assignedTo.fullName}` : 'Lead đang chờ giao.'}
              {result.duplicate && ' — đã ghi nhận "liên hệ lại" và báo cho người phụ trách.'}
            </p>
            <div className="flex gap-2">
              <Link href={`/leads/${result.leadId}`} onClick={close} className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                Mở lead
              </Link>
              <Button variant="outline" onClick={() => setResult(null)}>
                Tạo lead khác
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <Field label="Số điện thoại" htmlFor="ql-phone" error={errors.phone}>
              <Input id="ql-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" required autoFocus />
            </Field>
            <Field label="Tên khách" htmlFor="ql-name" error={errors.name}>
              <Input id="ql-name" name="name" required placeholder="Chị Hoa - shop mẹ bé Hải Phòng" />
            </Field>
            <Field label="Ghi chú" htmlFor="ql-note">
              <Textarea id="ql-note" name="note" placeholder="Quan tâm matcha, bánh kẹo…" />
            </Field>
            <Field label="Nguồn" htmlFor="ql-source">
              <Select id="ql-source" name="source" defaultValue="ZALO_COMPANY">
                {QUICK_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_SOURCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            {isSales && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="rotate" className="size-4 accent-[var(--primary)]" />
                Chia xoay vòng cho sales khác (người trực Zalo công ty)
              </label>
            )}
            <FormError message={error} />
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Đang tạo…' : 'Tạo lead'}
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
