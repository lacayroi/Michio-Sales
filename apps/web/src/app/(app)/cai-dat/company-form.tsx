'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/client';

interface Company {
  name: string;
  legalName?: string;
  address?: string;
  hotline?: string;
  zaloPhone?: string;
  website?: string;
  facebookPage?: string;
  taxCode?: string | null;
}

const FIELDS: [keyof Omit<Company, 'name'>, string][] = [
  ['legalName', 'Tên pháp nhân'],
  ['taxCode', 'Mã số thuế'],
  ['address', 'Địa chỉ'],
  ['hotline', 'Hotline'],
  ['zaloPhone', 'Zalo công ty'],
  ['website', 'Website'],
  ['facebookPage', 'Facebook Page'],
];

export function CompanyForm({ initial }: { initial: Company }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const profile = Object.fromEntries(FIELDS.map(([k]) => [k, String(f.get(k) ?? '').trim() || null]));
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await api('/api/v1/company', { method: 'PUT', body: { name: f.get('name'), profile } });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field label="Tên hiển thị" htmlFor="co-name">
        <Input id="co-name" name="name" defaultValue={initial.name} required />
      </Field>
      {FIELDS.map(([k, label]) => (
        <Field key={k} label={label} htmlFor={`co-${k}`} className={k === 'address' ? 'sm:col-span-2' : undefined}>
          <Input id={`co-${k}`} name={k} defaultValue={initial[k] ?? ''} />
        </Field>
      ))}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormError message={error} />
        {saved && (
          <p role="status" className="text-sm font-medium text-primary">
            Đã lưu
          </p>
        )}
        <Button type="submit" disabled={busy} className="self-start">
          Lưu thông tin công ty
        </Button>
      </div>
    </form>
  );
}
