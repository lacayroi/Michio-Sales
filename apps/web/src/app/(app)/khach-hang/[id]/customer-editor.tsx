'use client';

import { BUSINESS_MODEL_LABELS, ORDER_BAND_LABELS } from '@michio/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { categoryLabel } from '@/components/customer-profile';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, fieldErrors } from '@/lib/client';

const CATEGORIES = ['MATCHA_TEA', 'FOOD', 'CANDY', 'SPICE', 'DRINK', 'HOUSEHOLD', 'ORAL_CARE', 'PERSONAL_CARE', 'MOM_BABY', 'HEALTH', 'BEAUTY', 'OTHER'];

export interface EditableCustomer {
  id: string;
  contactName: string;
  phone: string | null;
  zaloPhone: string | null;
  email: string | null;
  shopName: string | null;
  taxCode: string | null;
  businessModel: string | null;
  expectedOrderBand: string | null;
  interestCategories: string[];
  province: string | null;
  address: string | null;
  facebookUrl: string | null;
  tags: string[];
  note: string | null;
  tier: string | null;
  priceListId: string | null;
  reorderCycleDays: number;
}

const local = (p: string | null) => (p?.startsWith('+84') ? `0${p.slice(3)}` : (p ?? ''));

export function CustomerEditor({
  customer: c,
  priceLists,
  suggestions,
}: {
  customer: EditableCustomer;
  priceLists: { id: string; name: string; tier: string }[] | null;
  suggestions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | 'edit' | 'merge'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim() || null;
    const body: Record<string, unknown> = {
      contactName: text('contactName') ?? '',
      phone: text('phone'),
      zaloPhone: text('zaloPhone'),
      email: text('email') ?? '',
      shopName: text('shopName'),
      taxCode: text('taxCode'),
      businessModel: text('businessModel'),
      expectedOrderBand: text('expectedOrderBand'),
      interestCategories: f.getAll('interestCategories').map(String),
      province: text('province'),
      address: text('address'),
      facebookUrl: text('facebookUrl'),
      tags: (text('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      note: text('note'),
    };
    const cycle = Number(f.get('reorderCycleDays'));
    if (cycle && cycle !== c.reorderCycleDays) body.reorderCycleDays = cycle;
    if (priceLists) {
      body.tier = text('tier');
      body.priceListId = text('priceListId');
    }
    setBusy(true);
    setError(null);
    setErrors({});
    const res = await api(`/api/v1/customers/${c.id}`, { method: 'PATCH', body });
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message ?? null);
      setErrors(fieldErrors(res.error));
      return;
    }
    setMode(null);
    router.refresh();
  }

  async function merge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sourceId = String(new FormData(e.currentTarget).get('sourceId') ?? '');
    if (!sourceId) return;
    if (!confirm('Gộp hồ sơ đã chọn vào hồ sơ này? Lead, đơn, hoạt động sẽ được chuyển sang; hồ sơ kia bị xóa mềm.')) return;
    setBusy(true);
    setError(null);
    const res = await api('/api/v1/customers/merge', { body: { targetId: c.id, sourceId } });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    setMode(null);
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
      <Button size="sm" variant="outline" onClick={() => setMode('edit')}>
        Sửa hồ sơ
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setMode('merge')}>
        Gộp hồ sơ{suggestions.length ? ` (${suggestions.length} gợi ý)` : ''}
      </Button>

      <Dialog open={mode === 'edit'} onClose={() => setMode(null)} title="Sửa hồ sơ khách" className="max-w-2xl">
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Field label="Người liên hệ" htmlFor="contactName" error={errors.contactName}>
            <Input id="contactName" name="contactName" defaultValue={c.contactName} required />
          </Field>
          <Field label="Tên shop / doanh nghiệp" htmlFor="shopName">
            <Input id="shopName" name="shopName" defaultValue={c.shopName ?? ''} />
          </Field>
          <Field label="Số điện thoại" htmlFor="phone" error={errors.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={local(c.phone)} />
          </Field>
          <Field label="Số Zalo (nếu khác)" htmlFor="zaloPhone" error={errors.zaloPhone}>
            <Input id="zaloPhone" name="zaloPhone" type="tel" defaultValue={local(c.zaloPhone)} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" defaultValue={c.email ?? ''} />
          </Field>
          <Field label="Mã số thuế" htmlFor="taxCode">
            <Input id="taxCode" name="taxCode" defaultValue={c.taxCode ?? ''} />
          </Field>
          <Field label="Mô hình kinh doanh" htmlFor="businessModel">
            <Select id="businessModel" name="businessModel" defaultValue={c.businessModel ?? ''}>
              <option value="">—</option>
              {Object.entries(BUSINESS_MODEL_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mức nhập dự kiến" htmlFor="expectedOrderBand">
            <Select id="expectedOrderBand" name="expectedOrderBand" defaultValue={c.expectedOrderBand ?? ''}>
              <option value="">—</option>
              {Object.entries(ORDER_BAND_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Nhóm hàng quan tâm</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="interestCategories" value={cat} defaultChecked={c.interestCategories.includes(cat)} className="size-4" />
                  {categoryLabel(cat)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Tỉnh/thành" htmlFor="province">
            <Input id="province" name="province" defaultValue={c.province ?? ''} />
          </Field>
          <Field label="Link Facebook" htmlFor="facebookUrl">
            <Input id="facebookUrl" name="facebookUrl" defaultValue={c.facebookUrl ?? ''} />
          </Field>
          <Field label="Địa chỉ giao hàng" htmlFor="address" className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={c.address ?? ''} />
          </Field>
          <Field label="Tag (cách nhau dấu phẩy)" htmlFor="tags">
            <Input id="tags" name="tags" defaultValue={c.tags.join(', ')} />
          </Field>
          <Field label="Chu kỳ tái đặt (ngày)" htmlFor="reorderCycleDays" hint="Sửa tay sẽ khóa tự tính lại">
            <Input id="reorderCycleDays" name="reorderCycleDays" type="number" min={7} max={120} defaultValue={c.reorderCycleDays} />
          </Field>
          {priceLists && (
            <>
              <Field label="Cấp khách" htmlFor="tier">
                <Input id="tier" name="tier" defaultValue={c.tier ?? ''} placeholder="SI_1, SI_2, DAI_LY" />
              </Field>
              <Field label="Bảng giá sỉ" htmlFor="priceListId">
                <Select id="priceListId" name="priceListId" defaultValue={c.priceListId ?? ''}>
                  <option value="">—</option>
                  {priceLists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label="Ghi chú" htmlFor="note" className="sm:col-span-2">
            <Textarea id="note" name="note" defaultValue={c.note ?? ''} />
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <FormError message={error} />
            <Button type="submit" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={mode === 'merge'} onClose={() => setMode(null)} title="Gộp hồ sơ khách">
        <form onSubmit={merge} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Dùng khi cùng một khách có 2 hồ sơ (vd nhắn Facebook trước, sau đó để lại SĐT). Hồ sơ được chọn sẽ gộp vào hồ sơ đang xem.
          </p>
          {suggestions.length ? (
            <Field label="Gợi ý (trùng tên + tỉnh)" htmlFor="sourceId">
              <Select id="sourceId" name="sourceId" required defaultValue="">
                <option value="" disabled>
                  Chọn hồ sơ cần gộp…
                </option>
                {suggestions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Mã hồ sơ cần gộp" htmlFor="sourceId" hint="Không có gợi ý trùng tên + tỉnh. Dán mã hồ sơ (phần cuối đường dẫn /khach-hang/…).">
              <Input id="sourceId" name="sourceId" required />
            </Field>
          )}
          <FormError message={error} />
          <Button type="submit" disabled={busy}>
            Gộp
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
