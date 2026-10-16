'use client';

import { ORDER_BAND_LABELS } from '@michio/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/client';

interface Values {
  'sla.businessHoursOnly': boolean;
  'assignment.outOfHoursMode': 'ASSIGN_NOW' | 'HOLD';
  'assignment.keepCustomerOwner': boolean;
  'assignment.preferPreviousOwner': boolean;
  'assignment.reclaimOnContactSlaBreach': boolean;
  'priority.byOrderBand': Record<string, 'HOT' | 'WARM' | 'COLD'>;
}

const TOGGLES: [keyof Values, string][] = [
  ['sla.businessHoursOnly', 'Chỉ tính thời hạn trong giờ làm việc (bỏ Chủ nhật, ngày lễ, nghỉ trưa)'],
  ['assignment.keepCustomerOwner', 'Khách đã mua quay lại → giao thẳng cho sales đang phụ trách'],
  ['assignment.preferPreviousOwner', 'Khách từng “không thành công” quay lại → ưu tiên sales cũ'],
  ['assignment.reclaimOnContactSlaBreach', 'Thu hồi lead khi quá hạn liên hệ đầu tiên (mặc định chỉ cảnh báo)'],
];

/** SPEC 7.1 settings that drive the engine. Each changed key is saved (and audited) separately. */
export function AssignmentSettings({ initial }: { initial: Values }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next: Values = {
      'sla.businessHoursOnly': f.get('sla.businessHoursOnly') === 'on',
      'assignment.outOfHoursMode': f.get('assignment.outOfHoursMode') === 'HOLD' ? 'HOLD' : 'ASSIGN_NOW',
      'assignment.keepCustomerOwner': f.get('assignment.keepCustomerOwner') === 'on',
      'assignment.preferPreviousOwner': f.get('assignment.preferPreviousOwner') === 'on',
      'assignment.reclaimOnContactSlaBreach': f.get('assignment.reclaimOnContactSlaBreach') === 'on',
      'priority.byOrderBand': Object.fromEntries(Object.keys(ORDER_BAND_LABELS).map((b) => [b, String(f.get(`band-${b}`)) as 'HOT' | 'WARM' | 'COLD'])),
    };
    setBusy(true);
    setError(null);
    setSaved(false);
    for (const key of Object.keys(next) as (keyof Values)[]) {
      if (JSON.stringify(next[key]) === JSON.stringify(initial[key])) continue;
      const res = await api(`/api/v1/settings/${key}`, { method: 'PUT', body: { value: next[key] } });
      if (!res.ok) {
        setBusy(false);
        return setError(res.error?.message ?? null);
      }
    }
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      {TOGGLES.map(([key, label]) => (
        <label key={key} className="flex items-start gap-2 text-sm">
          <input type="checkbox" name={key} defaultChecked={initial[key] as boolean} className="mt-0.5 size-4" />
          {label}
        </label>
      ))}
      <Field label="Lead đến ngoài giờ / Chủ nhật" htmlFor="ooh">
        <Select id="ooh" name="assignment.outOfHoursMode" defaultValue={initial['assignment.outOfHoursMode']}>
          <option value="ASSIGN_NOW">Chia ngay, thời hạn tính từ đầu giờ làm việc kế tiếp</option>
          <option value="HOLD">Giữ lại, chia lúc 08:00</option>
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Mức ưu tiên theo mức nhập (form web)</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(ORDER_BAND_LABELS).map(([band, label]) => (
            <label key={band} className="flex items-center justify-between gap-2 text-sm">
              <span>{label}</span>
              <Select name={`band-${band}`} defaultValue={initial['priority.byOrderBand'][band] ?? 'COLD'} className="h-9 w-28">
                <option value="HOT">HOT</option>
                <option value="WARM">Ấm</option>
                <option value="COLD">Thường</option>
              </Select>
            </label>
          ))}
        </div>
      </fieldset>
      <FormError message={error} />
      {saved && (
        <p role="status" className="text-sm font-medium text-primary">
          Đã lưu
        </p>
      )}
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? 'Đang lưu…' : 'Lưu cài đặt'}
      </Button>
    </form>
  );
}
