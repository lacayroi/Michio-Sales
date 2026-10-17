'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

type Profile = Record<'legalName' | 'address' | 'hotline' | 'zaloPhone' | 'website' | 'email' | 'facebookPage' | 'taxCode' | 'bankName' | 'bankAccount' | 'bankAccountName' | 'quoteTerms', string>;

const FIELDS: [keyof Profile, string, string?][] = [
  ['legalName', 'Tên công ty'], ['address', 'Địa chỉ'], ['hotline', 'Hotline'], ['zaloPhone', 'Zalo công ty'], ['website', 'Website'], ['email', 'Email'],
  ['facebookPage', 'Facebook Page'], ['taxCode', 'Mã số thuế'], ['bankName', 'Ngân hàng'], ['bankAccount', 'Số tài khoản'], ['bankAccountName', 'Chủ tài khoản'],
];

export function CompanyForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/v1/company-profile', { method: 'PUT', body: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || (['legalName', 'address', 'hotline'].includes(k) ? x : null)])) });
      toast('Đã lưu thông tin công ty');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
      {FIELDS.map(([k, label]) => (
        <div key={k} className={k === 'address' || k === 'legalName' ? 'sm:col-span-2' : ''}>
          <Field id={`cp-${k}`} label={label}><Input id={`cp-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} required={k === 'legalName' || k === 'address' || k === 'hotline'} /></Field>
        </div>
      ))}
      <div className="sm:col-span-2">
        <Field id="cp-terms" label="Điều kiện mặc định trên báo giá" hint="Giao hàng, thanh toán… (sales sửa được cho từng báo giá)"><Textarea id="cp-terms" rows={4} value={v.quoteTerms} onChange={(e) => setV({ ...v, quoteTerms: e.target.value })} /></Field>
      </div>
      <div className="sm:col-span-2 flex justify-end"><Button type="submit" disabled={busy}>Lưu</Button></div>
    </form>
  );
}
