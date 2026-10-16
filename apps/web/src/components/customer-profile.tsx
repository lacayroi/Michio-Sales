import { BUSINESS_MODEL_LABELS, formatDate, formatVnd, INTEREST_CATEGORY_LABELS, ORDER_BAND_LABELS } from '@michio/shared';
import type { ReactNode } from 'react';
import { LifecycleBadge } from './badges';
import { PhoneActions } from './phone-actions';

interface ProfileCustomer {
  contactName: string;
  phone: string | null;
  email: string | null;
  shopName: string | null;
  taxCode: string | null;
  businessModel: keyof typeof BUSINESS_MODEL_LABELS | null;
  expectedOrderBand: keyof typeof ORDER_BAND_LABELS | null;
  interestCategories: string[];
  province: string | null;
  address: string | null;
  facebookUrl: string | null;
  zaloPhone: string | null;
  tags: string[];
  note: string | null;
  lifecycle: 'PROSPECT' | 'NEW_CUSTOMER' | 'REPEAT' | 'AT_RISK' | 'DORMANT';
  orderCount: number;
  totalRevenue: { toString(): string };
  lastOrderAt: Date | null;
  nextReorderAt: Date | null;
  tier: string | null;
  owner: { fullName: string } | null;
  identities: { externalUserId: string; displayName: string | null; channelAccount: { name: string } }[];
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </div>
);

export function CustomerProfile({ c, actions }: { c: ProfileCustomer; actions?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold">{c.shopName ?? c.contactName}</p>
          {c.shopName && <p className="text-sm text-muted-foreground">{c.contactName}</p>}
        </div>
        <div className="flex items-center gap-2">
          <LifecycleBadge lifecycle={c.lifecycle} />
          {actions}
        </div>
      </div>
      <dl className="divide-y divide-border">
        <Row label="SĐT"><PhoneActions phone={c.phone} /></Row>
        {c.email && <Row label="Email"><a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a></Row>}
        <Row label="Mô hình">{c.businessModel ? BUSINESS_MODEL_LABELS[c.businessModel] : '—'}</Row>
        <Row label="Mức nhập">{c.expectedOrderBand ? ORDER_BAND_LABELS[c.expectedOrderBand] : '—'}</Row>
        <Row label="Quan tâm">{c.interestCategories.length ? c.interestCategories.map((x) => INTEREST_CATEGORY_LABELS[x] ?? x).join(', ') : '—'}</Row>
        <Row label="Tỉnh/thành">{c.province ?? '—'}</Row>
        {c.address && <Row label="Địa chỉ giao">{c.address}</Row>}
        {c.taxCode && <Row label="MST">{c.taxCode}</Row>}
        {c.facebookUrl && <Row label="Facebook"><a className="text-primary hover:underline dark:text-brand-green" href={c.facebookUrl} target="_blank" rel="noreferrer">Mở trang</a></Row>}
        {c.identities.length > 0 && <Row label="Kênh">{c.identities.map((i) => `${i.channelAccount.name}${i.displayName ? ` (${i.displayName})` : ''}`).join(', ')}</Row>}
        <Row label="Sales phụ trách">{c.owner?.fullName ?? '—'}</Row>
        <Row label="Mua hàng">
          {c.orderCount > 0 ? `${c.orderCount} đơn · ${formatVnd(c.totalRevenue)}${c.lastOrderAt ? ` · gần nhất ${formatDate(c.lastOrderAt)}` : ''}` : 'Chưa có đơn'}
        </Row>
        {c.nextReorderAt && <Row label="Hạn tái đặt">{formatDate(c.nextReorderAt)}</Row>}
        {c.tier && <Row label="Cấp khách">{c.tier}</Row>}
        {c.tags.length > 0 && <Row label="Tag">{c.tags.join(', ')}</Row>}
        {c.note && <Row label="Ghi chú"><span className="whitespace-pre-line">{c.note}</span></Row>}
      </dl>
    </div>
  );
}
