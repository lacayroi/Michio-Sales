'use client';

import { DELIVERY_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@michio/shared';
import { Repeat } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

/** Kế toán / kho cập nhật thanh toán & giao hàng (SPEC 6.7). */
export function FulfillmentPanel(p: { orderId: string; payment: string; paid: number; total: number; delivery: string; tracking: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [payment, setPayment] = useState(p.payment);
  const [paid, setPaid] = useState(p.paid);
  const [delivery, setDelivery] = useState(p.delivery);
  const [tracking, setTracking] = useState(p.tracking ?? '');
  const [busy, setBusy] = useState(false);

  async function save(kind: 'payment' | 'delivery') {
    if (kind === 'delivery' && delivery === 'CANCELLED' && !window.confirm('Hủy đơn? Doanh số và lịch nhắc tái đặt của khách sẽ tính lại.')) return;
    setBusy(true);
    try {
      if (kind === 'payment') await api(`/api/v1/orders/${p.orderId}/payment`, { method: 'PATCH', body: { paymentStatus: payment, paidAmount: paid } });
      else await api(`/api/v1/orders/${p.orderId}/delivery`, { method: 'PATCH', body: { deliveryStatus: delivery, trackingCode: tracking || null } });
      toast('Đã cập nhật');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không cập nhật được', 'error');
    } finally {
      setBusy(false);
    }
  }

  const cancelled = p.delivery === 'CANCELLED';
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4" data-testid="fulfillment">
      <div className="flex flex-col gap-2">
        <Field id="f-pay" label="Thanh toán">
          <Select id="f-pay" value={payment} onChange={(e) => setPayment(e.target.value)} disabled={cancelled}>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {payment === 'PARTIAL' && (
          <Field id="f-paid" label="Số tiền đã trả (₫)">
            <Input id="f-paid" type="number" min={0} max={p.total} step={1000} value={paid} onChange={(e) => setPaid(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          </Field>
        )}
        <Button variant="outline" disabled={busy || cancelled} onClick={() => save('payment')}>Lưu thanh toán</Button>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <Field id="f-del" label="Giao hàng">
          <Select id="f-del" value={delivery} onChange={(e) => setDelivery(e.target.value)} disabled={cancelled}>
            {Object.entries(DELIVERY_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field id="f-track" label="Mã vận đơn"><Input id="f-track" value={tracking} onChange={(e) => setTracking(e.target.value)} disabled={cancelled} /></Field>
        <Button variant="outline" disabled={busy || cancelled} onClick={() => save('delivery')}>Lưu giao hàng</Button>
      </div>
    </div>
  );
}

/** "Tạo đơn lặp lại" (SPEC 6.8): a new draft quote from this order at today's prices. */
export function RepeatOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          const q = await api<{ id: string }>(`/api/v1/orders/${orderId}/repeat`, { body: {} });
          router.push(`/bao-gia/${q.id}`);
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Không tạo được', 'error');
        }
      }}
    >
      <Repeat className="size-4" />
      Tạo đơn lặp lại
    </Button>
  );
}
