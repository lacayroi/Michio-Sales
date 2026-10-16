'use client';

import { BUSINESS_MODEL_LABELS, INTEREST_CATEGORY_LABELS, ORDER_BAND_LABELS } from '@michio/shared';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';
import { useToast } from './ui/toast';

export interface CustomerFormValues {
  id: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  shopName: string | null;
  taxCode: string | null;
  businessModel: string | null;
  expectedOrderBand: string | null;
  interestCategories: string[];
  province: string | null;
  address: string | null;
  facebookUrl: string | null;
  zaloPhone: string | null;
  tags: string[];
  note: string | null;
}

export function EditCustomerButton({ customer }: { customer: CustomerFormValues }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const toast = useToast();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = String(f.get(k) ?? '').trim();
      return v === '' ? null : v;
    };
    setBusy(true);
    setErrors({});
    try {
      await api(`/api/v1/customers/${customer.id}`, {
        method: 'PATCH',
        body: {
          contactName: s('contactName') ?? customer.contactName,
          phone: s('phone'),
          email: s('email') ?? '',
          shopName: s('shopName'),
          taxCode: s('taxCode'),
          businessModel: s('businessModel'),
          expectedOrderBand: s('expectedOrderBand'),
          interestCategories: f.getAll('interestCategories').map(String),
          province: s('province'),
          address: s('address'),
          facebookUrl: s('facebookUrl'),
          zaloPhone: s('zaloPhone'),
          tags: (s('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
          note: s('note'),
        },
      });
      toast('Đã lưu hồ sơ khách');
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.details?.fieldErrors) {
        setErrors(Object.fromEntries(Object.entries(err.details.fieldErrors).map(([k, v]) => [k, v[0] ?? ''])));
      }
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }

  const c = customer;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden />
        Sửa hồ sơ
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hồ sơ khách sỉ" wide>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="cf-contactName" label="Người liên hệ *" error={errors.contactName}>
            <Input id="cf-contactName" name="contactName" defaultValue={c.contactName} required />
          </Field>
          <Field id="cf-phone" label="Số điện thoại" error={errors.phone}>
            <Input id="cf-phone" name="phone" inputMode="tel" defaultValue={c.phone ? `0${c.phone.slice(3)}` : ''} />
          </Field>
          <Field id="cf-shopName" label="Tên shop / doanh nghiệp">
            <Input id="cf-shopName" name="shopName" defaultValue={c.shopName ?? ''} />
          </Field>
          <Field id="cf-email" label="Email" error={errors.email}>
            <Input id="cf-email" name="email" type="email" defaultValue={c.email ?? ''} />
          </Field>
          <Field id="cf-businessModel" label="Mô hình kinh doanh">
            <Select id="cf-businessModel" name="businessModel" defaultValue={c.businessModel ?? ''}>
              <option value="">—</option>
              {Object.entries(BUSINESS_MODEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field id="cf-band" label="Mức nhập dự kiến">
            <Select id="cf-band" name="expectedOrderBand" defaultValue={c.expectedOrderBand ?? ''}>
              <option value="">—</option>
              {Object.entries(ORDER_BAND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Nhóm hàng quan tâm</legend>
            <div className="flex flex-wrap gap-3">
              {Object.entries(INTEREST_CATEGORY_LABELS).map(([k, v]) => (
                <label key={k} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="interestCategories" value={k} defaultChecked={c.interestCategories.includes(k)} className="size-4 accent-[var(--primary)]" />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
          <Field id="cf-province" label="Tỉnh/thành">
            <Input id="cf-province" name="province" defaultValue={c.province ?? ''} />
          </Field>
          <Field id="cf-taxCode" label="Mã số thuế">
            <Input id="cf-taxCode" name="taxCode" defaultValue={c.taxCode ?? ''} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="cf-address" label="Địa chỉ giao hàng">
              <Input id="cf-address" name="address" defaultValue={c.address ?? ''} />
            </Field>
          </div>
          <Field id="cf-facebookUrl" label="Link Facebook">
            <Input id="cf-facebookUrl" name="facebookUrl" defaultValue={c.facebookUrl ?? ''} />
          </Field>
          <Field id="cf-zaloPhone" label="SĐT Zalo (nếu khác)">
            <Input id="cf-zaloPhone" name="zaloPhone" defaultValue={c.zaloPhone ?? ''} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="cf-tags" label="Tag" hint="Cách nhau dấu phẩy">
              <Input id="cf-tags" name="tags" defaultValue={c.tags.join(', ')} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="cf-note" label="Ghi chú">
              <Textarea id="cf-note" name="note" rows={3} defaultValue={c.note ?? ''} />
            </Field>
          </div>
          <Button type="submit" disabled={busy} className="sm:col-span-2">
            Lưu
          </Button>
        </form>
      </Dialog>
    </>
  );
}
