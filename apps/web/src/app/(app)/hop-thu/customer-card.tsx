'use client';

import { formatVnd, LIFECYCLE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LeadStatusBadge } from '@/components/badges';
import { PhoneActions } from '@/components/phone-actions';
import { buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

export interface CardData {
  customerId: string;
  contactName: string;
  shopName: string | null;
  phone: string | null;
  province: string | null;
  lifecycle: keyof typeof LIFECYCLE_LABELS;
  orderCount: number;
  totalRevenue: number;
  ownerName: string | null;
  lead: { id: string; code: number; status: 'NEW' | 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'WON' | 'LOST'; need: string | null; stage: string | null } | null;
}

const STAGES = [
  ['DA_LIEN_HE', 'Đã liên hệ'],
  ['TU_VAN', 'Tư vấn nhóm hàng'],
  ['BAO_GIA', 'Đã gửi báo giá'],
  ['CHOT', 'Chốt đơn'],
  ['THUA', 'Không thành công'],
] as const;

/** Thẻ khách (SPEC 6.4): profile summary, quick stage change, quote / task shortcuts. */
export function CustomerCard({ conv: c, canEdit }: { conv: CardData; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function changeStage(stage: string) {
    if (!c.lead || !stage) return;
    let note: string | undefined;
    if (stage === 'THUA') {
      note = window.prompt('Lý do không thành công (vd: giá cao, chưa có nhu cầu…)') ?? undefined;
      if (note === undefined) return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/leads/${c.lead.id}/stage`, { body: { stage, note } });
      toast('Đã cập nhật giai đoạn');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không đổi được giai đoạn', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="customer-card">
      <div>
        <p className="text-base font-semibold">{c.shopName ?? c.contactName}</p>
        {c.shopName && <p className="text-muted-foreground">{c.contactName}</p>}
        {c.province && <p className="text-muted-foreground">{c.province}</p>}
      </div>
      <PhoneActions phone={c.phone} />
      <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
        <dt className="text-muted-foreground">Vòng đời</dt><dd>{LIFECYCLE_LABELS[c.lifecycle]}</dd>
        <dt className="text-muted-foreground">Mua hàng</dt><dd>{c.orderCount ? `${c.orderCount} đơn · ${formatVnd(c.totalRevenue)}` : 'Chưa có đơn'}</dd>
        <dt className="text-muted-foreground">Phụ trách</dt><dd>{c.ownerName ?? '—'}</dd>
      </dl>
      {c.lead && (
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Link href={`/leads/${c.lead.id}`} className="font-medium hover:underline">Lead #{c.lead.code}</Link>
            <LeadStatusBadge status={c.lead.status} />
          </div>
          {c.lead.need && <p className="mb-2 line-clamp-3 text-muted-foreground">{c.lead.need}</p>}
          {canEdit && c.lead.status === 'IN_PROGRESS' && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Giai đoạn</span>
              <Select value={c.lead.stage ?? ''} onChange={(e) => changeStage(e.target.value)} disabled={busy} aria-label="Đổi giai đoạn">
                <option value="">— Mới —</option>
                {STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </label>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={`/khach-hang/${c.customerId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Hồ sơ khách</Link>
        {canEdit && <Link href={`/bao-gia/moi?customerId=${c.customerId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Tạo báo giá</Link>}
      </div>
    </div>
  );
}
