'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { useToast } from './ui/toast';
import { api } from '@/lib/client';

/**
 * Cấp khách / bảng giá (Owner/Manager, SPEC 6.5) and the reorder cycle (sales/Owner, SPEC 6.8:
 * "sửa tay được, khóa không tự tính lại").
 */
export function CustomerCommerce(p: {
  customerId: string;
  priceListId: string | null;
  priceLists: { id: string; name: string; tier: string }[] | null;
  cycleDays: number;
  cycleLocked: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [priceListId, setPriceListId] = useState(p.priceListId ?? '');
  const [cycle, setCycle] = useState(String(p.cycleDays));
  async function patch(body: Record<string, unknown>, ok: string) {
    try {
      await api(`/api/v1/customers/${p.customerId}`, { method: 'PATCH', body });
      toast(ok);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm" data-testid="customer-commerce">
      {p.priceLists && (
        <label className="flex flex-col gap-1">
          <span className="font-medium">Cấp khách / bảng giá sỉ</span>
          <span className="flex gap-2">
            <Select value={priceListId} onChange={(e) => setPriceListId(e.target.value)} aria-label="Bảng giá">
              <option value="">Mặc định (theo cấp, hoặc Sỉ cấp 1)</option>
              {p.priceLists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.tier})</option>)}
            </Select>
            <Button variant="outline" onClick={() => patch({ priceListId: priceListId || null }, 'Đã đổi bảng giá')}>Lưu</Button>
          </span>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-medium">Chu kỳ tái đặt (ngày)</span>
        <span className="flex items-center gap-2">
          <Input type="number" min={7} max={365} value={cycle} onChange={(e) => setCycle(e.target.value)} className="h-10 w-24" aria-label="Chu kỳ tái đặt" />
          <Button variant="outline" onClick={() => patch({ reorderCycleDays: Number(cycle) }, 'Đã khóa chu kỳ tái đặt')}>Đặt cố định</Button>
          {p.cycleLocked && <Button variant="ghost" onClick={() => patch({ reorderCycleDays: null }, 'Đã mở khóa — hệ thống tự tính')}>Tự tính</Button>}
        </span>
        <span className="text-xs text-muted-foreground">{p.cycleLocked ? 'Đang cố định (không tự tính lại).' : 'Tự tính = trung vị khoảng cách giữa các đơn sau ≥ 3 đơn.'}</span>
      </label>
    </div>
  );
}
