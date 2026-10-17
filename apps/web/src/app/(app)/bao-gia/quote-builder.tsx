'use client';

import { formatVnd } from '@michio/shared';
import { AlertTriangle, Loader2, Package, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

export interface ProductHit { id: string; sku: string; name: string; imageUrl: string | null; inStock: boolean; unit: string | null; unitsPerCase: number | null }
export interface CustomerHit { id: string; contactName: string; shopName: string | null; phone: string | null; province: string | null }
interface Priced { productId: string; unitPrice: number; source: 'PRICE_LIST' | 'RETAIL' | 'NONE'; belowMinQty: boolean; minQty: number }

export interface BuilderLine {
  productId: string;
  sku: string;
  name: string;
  unit: string | null;
  unitsPerCase: number | null;
  imageUrl: string | null;
  inStock: boolean;
  qty: number;
  discountPct: number;
}

interface Props {
  quoteId?: string;
  customer: CustomerHit | null;
  dealId?: string | null;
  initial?: { lines: BuilderLine[]; shippingFee: number; terms: string | null };
  maxDiscountPct: number;
  canApprove: boolean;
}

const lineGross = (l: BuilderLine, p?: Priced) => Math.round(l.qty * (p?.unitPrice ?? 0));
const lineTotal = (l: BuilderLine, p?: Priced) => lineGross(l, p) - Math.round((lineGross(l, p) * l.discountPct) / 100);

/** S9 trình tạo báo giá: tìm sản phẩm (không dấu, có ảnh), giá tự theo cấp khách, Enter để thêm. */
export function QuoteBuilder(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerHit | null>(p.customer);
  const [lines, setLines] = useState<BuilderLine[]>(p.initial?.lines ?? []);
  const [shippingFee, setShippingFee] = useState(p.initial?.shippingFee ?? 0);
  const [terms, setTerms] = useState(p.initial?.terms ?? '');
  const [priced, setPriced] = useState<Record<string, Priced>>({});
  const [priceList, setPriceList] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Re-price whenever customer or quantities change (tier + quantity breaks are server-side).
  const priceKey = useMemo(() => JSON.stringify([customer?.id, lines.map((l) => [l.productId, l.qty])]), [customer?.id, lines]);
  useEffect(() => {
    if (!lines.length) return;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ priceList: { name: string } | null; lines: Priced[] }>('/api/v1/pricing/resolve', {
          body: { customerId: customer?.id ?? null, items: lines.map((l) => ({ productId: l.productId, qty: l.qty })) },
        });
        const map: Record<string, Priced> = {};
        r.lines.forEach((x, i) => (map[`${i}`] = x));
        setPriced(map);
        setPriceList(r.priceList?.name ?? null);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Không tính được giá', 'error');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [priceKey]);

  const addProduct = useCallback((prod: ProductHit) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === prod.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + (prod.unitsPerCase ?? 1) } : l));
      return [...ls, { productId: prod.id, sku: prod.sku, name: prod.name, unit: prod.unit, unitsPerCase: prod.unitsPerCase, imageUrl: prod.imageUrl, inStock: prod.inStock, qty: prod.unitsPerCase ?? 1, discountPct: 0 }];
    });
    searchRef.current?.focus();
  }, []);

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    lines.forEach((l, i) => {
      const g = lineGross(l, priced[`${i}`]);
      subtotal += g;
      discount += g - lineTotal(l, priced[`${i}`]);
    });
    return { subtotal, discount, total: subtotal - discount + shippingFee };
  }, [lines, priced, shippingFee]);
  const overDiscount = lines.some((l) => l.discountPct > p.maxDiscountPct);

  async function save() {
    if (!customer) return toast('Chọn khách trước', 'error');
    if (!lines.length) return toast('Thêm ít nhất 1 sản phẩm', 'error');
    setSaving(true);
    try {
      const body = { customerId: customer.id, dealId: p.dealId ?? undefined, items: lines.map((l) => ({ productId: l.productId, qty: l.qty, discountPct: l.discountPct })), shippingFee, terms: terms || null };
      const q = p.quoteId
        ? await api<{ id: string; status: string }>(`/api/v1/quotes/${p.quoteId}`, { method: 'PATCH', body })
        : await api<{ id: string; status: string }>('/api/v1/quotes', { body });
      toast(q.status === 'PENDING_APPROVAL' ? 'Đã lưu — chờ Owner duyệt chiết khấu' : 'Đã lưu báo giá');
      router.push(`/bao-gia/${q.id}`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <CustomerPicker value={customer} onChange={setCustomer} locked={Boolean(p.quoteId)} />

      <div className="rounded-xl border border-border bg-surface p-3">
        <ProductSearch inputRef={searchRef} onPick={addProduct} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm" data-testid="quote-lines">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-2">Sản phẩm</th>
                <th className="w-24 py-2 pr-2 text-right">SL</th>
                <th className="w-28 py-2 pr-2 text-right">Đơn giá</th>
                <th className="w-20 py-2 pr-2 text-right">CK %</th>
                <th className="w-32 py-2 pr-2 text-right">Thành tiền</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Gõ tên hoặc mã sản phẩm ở ô tìm kiếm, Enter để thêm.</td></tr>
              )}
              {lines.map((l, i) => {
                const pr = priced[`${i}`];
                return (
                  <tr key={l.productId} className="border-b border-border align-top">
                    <td className="py-2 pr-2">
                      <div className="flex gap-2">
                        {l.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.imageUrl} alt="" className="size-9 rounded object-cover" />
                        ) : <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted"><Package className="size-4 text-muted-foreground" /></span>}
                        <div className="min-w-0">
                          <p className="font-medium">{l.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.sku}{l.unitsPerCase ? ` · ${l.unitsPerCase} ${l.unit ?? ''}/thùng` : ''}
                            {!l.inStock && <span className="text-accent-text"> · hết hàng</span>}
                            {pr?.source === 'RETAIL' && <span className="text-accent-text"> · chưa có giá sỉ (đang dùng giá lẻ)</span>}
                            {pr?.belowMinQty && <span className="text-accent-text"> · dưới SL tối thiểu {pr.minQty}</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-2"><Input type="number" min={1} value={l.qty} aria-label={`Số lượng ${l.sku}`} className="h-9 text-right"
                      onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, qty: Math.max(1, Math.round(Number(e.target.value) || 1)) } : x)))} /></td>
                    <td className="py-2 pr-2 text-right tabular-nums">{pr ? formatVnd(pr.unitPrice) : <Loader2 className="ml-auto size-4 animate-spin" />}</td>
                    <td className="py-2 pr-2"><Input type="number" min={0} max={100} step={0.5} value={l.discountPct} aria-label={`Chiết khấu ${l.sku}`}
                      className={cn('h-9 text-right', l.discountPct > p.maxDiscountPct && 'ring-2 ring-accent')}
                      onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, discountPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } : x)))} /></td>
                    <td className="py-2 pr-2 text-right font-medium tabular-nums">{formatVnd(lineTotal(l, pr))}</td>
                    <td className="py-2"><Button variant="ghost" size="sm" aria-label={`Xóa ${l.sku}`} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 className="size-4" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border border-border bg-surface p-3">
          <label htmlFor="q-terms" className="mb-1 block text-sm font-medium">Điều kiện (in trên PDF)</label>
          <Textarea id="q-terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Để trống = điều kiện mặc định của công ty" />
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 text-sm">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted-foreground">Bảng giá</dt><dd>{priceList ?? '—'}</dd>
            <dt className="text-muted-foreground">Tiền hàng ({lines.length} dòng)</dt><dd className="tabular-nums">{formatVnd(totals.subtotal)}</dd>
            <dt className="text-muted-foreground">Chiết khấu thêm</dt><dd className="tabular-nums">−{formatVnd(totals.discount)}</dd>
            <dt className="self-center text-muted-foreground"><label htmlFor="q-ship">Phí vận chuyển</label></dt>
            <dd><Input id="q-ship" type="number" min={0} step={1000} value={shippingFee} onChange={(e) => setShippingFee(Math.max(0, Math.round(Number(e.target.value) || 0)))} className="h-8 w-32 text-right" /></dd>
            <dt className="border-t border-border pt-2 font-semibold">Tổng cộng</dt><dd className="border-t border-border pt-2 text-right font-semibold tabular-nums" data-testid="quote-total">{formatVnd(totals.total)}</dd>
          </dl>
          {overDiscount && !p.canApprove && (
            <p className="mt-2 flex gap-1.5 text-xs text-accent-text"><AlertTriangle className="size-4 shrink-0" />Chiết khấu thêm vượt {p.maxDiscountPct}% — báo giá cần Owner duyệt trước khi gửi.</p>
          )}
          <Button className="mt-3 w-full" onClick={save} disabled={saving || !customer || !lines.length}>{saving && <Loader2 className="size-4 animate-spin" />}{p.quoteId ? 'Lưu thay đổi' : 'Lưu báo giá'}</Button>
        </div>
      </div>
    </div>
  );
}

export function ProductSearch({ onPick, inputRef }: { onPick: (p: ProductHit) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState('');
  const [inStock, setInStock] = useState(false);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api<{ items: ProductHit[] }>(`/api/v1/products?forQuote=true&limit=8&q=${encodeURIComponent(q)}${inStock ? '&inStock=true' : ''}`).catch(() => ({ items: [] }));
      setHits(r.items);
      setActive(0);
    }, 150);
    return () => clearTimeout(t);
  }, [q, inStock]);
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]); }
    if (e.key === 'Escape') setQ('');
  }
  function pick(p: ProductHit) {
    onPick(p);
    setQ('');
    setHits([]);
  }
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} className="pl-9" placeholder="Thêm sản phẩm: gõ tên / mã (không cần dấu), ↑↓ chọn, Enter thêm" aria-label="Tìm sản phẩm để thêm" autoFocus />
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} className="size-4 accent-[var(--primary)]" />Còn hàng</label>
      </div>
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg" role="listbox" aria-label="Kết quả tìm sản phẩm">
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} className={cn('flex w-full items-center gap-3 px-3 py-2 text-left', i === active ? 'bg-primary/10' : 'hover:bg-muted')}>
                {h.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.imageUrl} alt="" className="size-9 rounded object-cover" />
                ) : <span className="flex size-9 items-center justify-center rounded bg-muted"><Package className="size-4 text-muted-foreground" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{h.name}</span>
                  <span className="text-xs text-muted-foreground">{h.sku}{h.unitsPerCase ? ` · ${h.unitsPerCase}/thùng` : ''}{!h.inStock && ' · hết hàng'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CustomerPicker({ value, onChange, locked }: { value: CustomerHit | null; onChange: (c: CustomerHit | null) => void; locked: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api<{ items: CustomerHit[] }>(`/api/v1/customers?limit=8&q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
      setHits(r.items);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3" data-testid="quote-customer">
        <div>
          <p className="font-semibold">{value.shopName ?? value.contactName}</p>
          <p className="text-sm text-muted-foreground">{[value.shopName ? value.contactName : null, value.phone?.replace(/^\+84/, '0'), value.province].filter(Boolean).join(' · ')}</p>
        </div>
        {!locked && <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Đổi khách</Button>}
      </div>
    );
  }
  return (
    <div className="relative rounded-xl border border-border bg-surface p-3">
      <label htmlFor="cust-search" className="mb-1 block text-sm font-medium">Khách hàng</label>
      <Input id="cust-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, shop, SĐT" />
      {hits.length > 0 && (
        <ul className="absolute left-3 right-3 z-20 mt-1 rounded-lg border border-border bg-surface shadow-lg">
          {hits.map((c) => (
            <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onChange(c)}>{c.shopName ?? c.contactName} <span className="text-muted-foreground">{c.phone?.replace(/^\+84/, '0')} {c.province}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
