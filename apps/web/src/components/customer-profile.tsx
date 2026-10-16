import { BUSINESS_MODEL_LABELS, formatDate, formatVnd, ORDER_BAND_LABELS } from '@michio/shared';
import type { ReactNode } from 'react';
import { LifecycleBadge } from './lead-badges';
import { PhoneLinks } from './phone-links';

const CATEGORY_LABELS: Record<string, string> = {
  MATCHA_TEA: 'Matcha & Trà',
  FOOD: 'Thực phẩm',
  CANDY: 'Bánh kẹo',
  SPICE: 'Gia vị',
  DRINK: 'Đồ uống',
  HOUSEHOLD: 'Gia dụng',
  ORAL_CARE: 'Răng miệng',
  PERSONAL_CARE: 'Chăm sóc cá nhân',
  MOM_BABY: 'Mẹ & Bé',
  HEALTH: 'Sức khỏe',
  BEAUTY: 'Sắc đẹp',
  OTHER: 'Khác',
};
export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c;

export interface ProfileCustomer {
  contactName: string;
  phone: string | null;
  zaloPhone: string | null;
  email: string | null;
  shopName: string | null;
  taxCode: string | null;
  businessModel: keyof typeof BUSINESS_MODEL_LABELS | null;
  expectedOrderBand: keyof typeof ORDER_BAND_LABELS | null;
  interestCategories: string[];
  province: string | null;
  address: string | null;
  facebookUrl: string | null;
  tier: string | null;
  lifecycle: 'PROSPECT' | 'NEW_CUSTOMER' | 'REPEAT' | 'AT_RISK' | 'DORMANT';
  orderCount: number;
  totalRevenue: { toString(): string };
  lastOrderAt: Date | null;
  nextReorderAt: Date | null;
  reorderCycleDays: number;
  tags: string[];
  note: string | null;
  owner: { fullName: string } | null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? '—'}</dd>
    </div>
  );
}

/** Wholesale customer profile (SPEC 6.2, S5). */
export function CustomerProfile({ c }: { c: ProfileCustomer }) {
  return (
    <dl className="divide-y divide-border">
      <Row label="Người liên hệ">{c.contactName}</Row>
      <Row label="Điện thoại">
        <PhoneLinks phone={c.phone} />
      </Row>
      {c.zaloPhone && c.zaloPhone !== c.phone && (
        <Row label="Zalo">
          <PhoneLinks phone={c.zaloPhone} />
        </Row>
      )}
      <Row label="Email">{c.email ? <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a> : null}</Row>
      <Row label="Shop / DN">{c.shopName}</Row>
      <Row label="Mô hình">{c.businessModel ? BUSINESS_MODEL_LABELS[c.businessModel] : null}</Row>
      <Row label="Mức nhập dự kiến">{c.expectedOrderBand ? ORDER_BAND_LABELS[c.expectedOrderBand] : null}</Row>
      <Row label="Nhóm hàng">{c.interestCategories.length ? c.interestCategories.map(categoryLabel).join(', ') : null}</Row>
      <Row label="Tỉnh/thành">{c.province}</Row>
      <Row label="Địa chỉ giao">{c.address}</Row>
      {c.facebookUrl && (
        <Row label="Facebook">
          <a href={c.facebookUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Mở trang
          </a>
        </Row>
      )}
      {c.taxCode && <Row label="Mã số thuế">{c.taxCode}</Row>}
      <Row label="Vòng đời">
        <LifecycleBadge lifecycle={c.lifecycle} />
      </Row>
      <Row label="Cấp khách">{c.tier}</Row>
      <Row label="Đã mua">{c.orderCount ? `${c.orderCount} đơn · ${formatVnd(c.totalRevenue)}` : 'Chưa có đơn'}</Row>
      {c.lastOrderAt && <Row label="Đơn gần nhất">{formatDate(c.lastOrderAt)}</Row>}
      {c.nextReorderAt && <Row label="Hẹn tái đặt">{`${formatDate(c.nextReorderAt)} (chu kỳ ${c.reorderCycleDays} ngày)`}</Row>}
      <Row label="Sales phụ trách">{c.owner?.fullName}</Row>
      {c.tags.length > 0 && <Row label="Tag">{c.tags.join(', ')}</Row>}
      {c.note && <Row label="Ghi chú">{c.note}</Row>}
    </dl>
  );
}
