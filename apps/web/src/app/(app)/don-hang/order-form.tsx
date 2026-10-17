'use client';

import { formatVnd } from '@michio/shared';
import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';
import { CustomerPicker, type CustomerHit, type ProductHit, ProductSearch } from '../bao-gia/quote-builder';

interface Line { productId: string; sku: string; name: string; qty: number; unitPrice: number | null; discount: number }

/** Ghi nhận đơn sỉ (SPEC 6.7): giá gợi ý theo cấp khách, sửa được; chiết khấu theo dòng (VND). */
export function OrderForm({ customer: initialCustomer, dealId }: { customer: CustomerHit | null; dealId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [customer, setCustomer] = useState(initialCustomer);
  const [lines, setLines] = useState<Line[]>([]);
  const [shippingFee, setShippingFee] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fill suggested prices for lines that have none yet.
  const missing = lines.filter((l) => l.unitPrice === null).map((l) => l.productId).join(',');
  useEffect(() => {
    if (!missing) return;
    void (async () => {
      const r = await api<{ lines: { productId: string; unitPrice: number }[] }>('/api/v1/pricing/resolve', {
        body: { customerId: customer?.id ?? null, items: lines.map((l) => ({ productId: l.productId, qty: Math.max(1, Math.round(l.qty)) })) },
      }).catch(() => null);
      if (r) setLines((ls) => ls.map((l, i) => (l.unitPrice === null ? { ...l, unitPrice: r.lines[i]?.unitPrice ?? 0 } : l)));
    })();
  }, [missing, customer?.id, lines]);

  const total = useMemo(() => lines.reduce((s, l) => s + Math.round(l.qty * (l.unitPrice ?? 0)) - l.discount, 0) + shippingFee, [lines, shippingFee]);

  function add(p: ProductHit) {
    setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls : [...ls, { productId: p.id, sku: p.sku, name: p.name, qty: p.unitsPerCase ?? 1, unitPrice: null, discount: 0 }]));
    searchRef.current?.focus();
  }

  async function save() {
    if (!customer || !lines.length) return;
    setSaving(true);
    try {
      const o = await api<{ id: string; code: string }>('/api/v1/orders', {
        body: {
          customerId: customer.id, dealId: dealId ?? undefined, shippingFee, paymentMethod, shippingAddress: address || undefined, note: note || undefined,
          items: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice ?? undefined, discount: l.discount })),
        },
      });
      toast(`Đã tạo đơn ${o.code}`);
      router.push(`/don-hang/${o.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tạo được đơn', 'error');
    } finally {
      setSaving(false);
    }
  }

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-4">
      <CustomerPicker value={customer} onChange={setCustomer} locked={false} />
      <div className="rounded-xl border border-border bg-surface p-3">
        <ProductSearch inputRef={searchRef} onPick={add} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border"><th className="py-2">Sản phẩm</th><th className="w-24 py-2 text-right">SL</th><th className="w-32 py-2 text-right">Đơn giá</th><th className="w-28 py-2 text-right">Chiết khấu (₫)</th><th className="w-32 py-2 text-right">Thành tiền</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.productId} className="border-b border-border">
                  <td className="py-2 pr-2"><p className="font-medium">{l.name}</p><p className="text-xs text-muted-foreground">{l.sku}</p></td>
                  <td className="py-2 pr-2"><Input type="number" min={1} value={l.qty} onChange={(e) => update(i, { qty: Math.max(1, Number(e.target.value) || 1) })} className="h-9 text-right" aria-label={`SL ${l.sku}`} /></td>
                  <td className="py-2 pr-2">{l.unitPrice === null ? <Loader2 className="ml-auto size-4 animate-spin" /> : <Input type="number" min={0} step={500} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="h-9 text-right" aria-label={`Đơn giá ${l.sku}`} />}</td>
                  <td className="py-2 pr-2"><Input type="number" min={0} step={1000} value={l.discount} onChange={(e) => update(i, { discount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="h-9 text-right" aria-label={`Chiết khấu ${l.sku}`} /></td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatVnd(Math.round(l.qty * (l.unitPrice ?? 0)) - l.discount)}</td>
                  <td><Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label={`Xóa ${l.sku}`}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2">
        <Field id="of-pay" label="Thanh toán"><Select id="of-pay" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option><option value="CREDIT">Công nợ</option></Select></Field>
        <Field id="of-ship" label="Phí vận chuyển (₫)"><Input id="of-ship" type="number" min={0} step={1000} value={shippingFee} onChange={(e) => setShippingFee(Math.max(0, Math.round(Number(e.target.value) || 0)))} /></Field>
        <Field id="of-addr" label="Địa chỉ giao" hint="Trống = địa chỉ trong hồ sơ khách"><Input id="of-addr" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field id="of-note" label="Ghi chú"><Textarea id="of-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <p className="text-lg font-semibold">Tổng: {formatVnd(total)}</p>
          <Button onClick={save} disabled={saving || !customer || !lines.length || lines.some((l) => l.unitPrice === null)}>{saving && <Loader2 className="size-4 animate-spin" />}Tạo đơn</Button>
        </div>
      </div>
    </div>
  );
}
