'use client';

import { formatVnd } from '@michio/shared';
import { Download, Save, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';
import { type ProductHit, ProductSearch } from '../../../bao-gia/quote-builder';

interface Row { productId: string; sku: string; name: string; unit: string | null; unitsPerCase: number | null; retailPrice: number | null; price: number; minQty: number; qtyBreaks: { minQty: number; price: number }[] }

const breaksText = (b: Row['qtyBreaks']) => b.map((x) => `${x.minQty}:${x.price}`).join('; ');
function parseBreaks(s: string): Row['qtyBreaks'] | null {
  if (!s.trim()) return [];
  const out = [];
  for (const part of s.split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = part.replace(/[.\s]/g, '').match(/^(\d+)[:=](\d+)$/);
    if (!m) return null;
    out.push({ minQty: Number(m[1]), price: Number(m[2]) });
  }
  return out;
}

/** Bảng giá sỉ (SPEC 6.6): giá / SL tối thiểu / bậc giá theo số lượng, sửa trực tiếp hoặc qua Excel. */
export function PriceListEditor({ list, items }: { list: { id: string; name: string; tier: string; validFrom: string; validTo: string }; items: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(items.map((r) => ({ ...r, breaks: breaksText(r.qtyBreaks), dirty: false })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [meta, setMeta] = useState(list);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch, dirty: true } : r)));

  function add(p: ProductHit) {
    if (rows.some((r) => r.productId === p.id)) return toast('Sản phẩm đã có trong bảng giá', 'info');
    setRows((rs) => [{ productId: p.id, sku: p.sku, name: p.name, unit: p.unit, unitsPerCase: p.unitsPerCase, retailPrice: null, price: 0, minQty: 1, qtyBreaks: [], breaks: '', dirty: true }, ...rs]);
  }

  async function saveAll() {
    const dirty = rows.filter((r) => r.dirty);
    for (const r of dirty) if (parseBreaks(r.breaks) === null) return toast(`Bậc giá của ${r.sku} phải dạng "24:95000; 48:90000"`, 'error');
    setBusy(true);
    try {
      await api(`/api/v1/price-lists/${list.id}`, { method: 'PATCH', body: { name: meta.name, tier: meta.tier, validFrom: meta.validFrom || null, validTo: meta.validTo || null } });
      if (dirty.length || removed.length) {
        await api(`/api/v1/price-lists/${list.id}/items`, {
          body: { items: [...dirty.map((r) => ({ productId: r.productId, price: r.price, minQty: r.minQty, qtyBreaks: parseBreaks(r.breaks) })), ...removed.map((productId) => ({ productId, remove: true }))] },
        });
      }
      toast('Đã lưu bảng giá');
      setRemoved([]);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    const form = new FormData();
    form.set('file', file);
    setBusy(true);
    try {
      const r = await api<{ applied: boolean; errors: { row: number; message: string }[]; rows: number }>(`/api/v1/price-lists/${list.id}/import`, { form });
      setErrors(r.errors);
      if (r.applied) {
        toast(`Đã nhập ${r.rows} dòng giá`);
        router.refresh();
      } else toast(`File có ${r.errors.length} lỗi — chưa thay đổi gì`, 'error');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không nhập được', 'error');
    } finally {
      setBusy(false);
    }
  }

  const dirtyCount = rows.filter((r) => r.dirty).length + removed.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-4">
        <Field id="pl-n" label="Tên"><Input id="pl-n" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
        <Field id="pl-t" label="Mã cấp"><Input id="pl-t" value={meta.tier} onChange={(e) => setMeta({ ...meta, tier: e.target.value.toUpperCase() })} /></Field>
        <Field id="pl-f" label="Hiệu lực từ"><Input id="pl-f" type="date" value={meta.validFrom} onChange={(e) => setMeta({ ...meta, validFrom: e.target.value })} /></Field>
        <Field id="pl-to" label="Đến"><Input id="pl-to" type="date" value={meta.validTo} onChange={(e) => setMeta({ ...meta, validTo: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/api/v1/price-lists/${list.id}/export`} className={buttonVariants({ variant: 'outline' })}><Download className="size-4" />Xuất Excel</a>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="size-4" />Nhập Excel</Button>
        <span className="text-xs text-muted-foreground">Cột: SKU, Tên, Giá sỉ, SL tối thiểu, Bậc giá (24:95000; 48:90000). Xuất ra để làm mẫu.</span>
        <Button className="ml-auto" disabled={busy} onClick={saveAll}><Save className="size-4" />Lưu{dirtyCount ? ` (${dirtyCount})` : ''}</Button>
      </div>
      {errors.length > 0 && (
        <ul className="rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm" role="alert">
          {errors.map((e, i) => <li key={i}>Dòng {e.row}: {e.message}</li>)}
        </ul>
      )}
      <div className="rounded-xl border border-border bg-surface p-3">
        <ProductSearch inputRef={searchRef} onPick={add} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="price-items">
            <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border"><th className="py-2">Sản phẩm</th><th className="py-2 text-right">Giá lẻ</th><th className="w-32 py-2">Giá sỉ (₫)</th><th className="w-24 py-2">SL tối thiểu</th><th className="w-56 py-2">Bậc giá (SL:giá; …)</th><th className="w-10" /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.productId} className={`border-b border-border ${r.dirty ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                  <td className="py-2 pr-2"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.sku}{r.unitsPerCase ? ` · ${r.unitsPerCase}/thùng` : ''}</p></td>
                  <td className="py-2 pr-2 text-right text-muted-foreground tabular-nums">{r.retailPrice ? formatVnd(r.retailPrice) : '—'}</td>
                  <td className="py-2 pr-2"><Input type="number" min={0} step={500} value={r.price} onChange={(e) => update(i, { price: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="h-9 text-right" aria-label={`Giá sỉ ${r.sku}`} /></td>
                  <td className="py-2 pr-2"><Input type="number" min={1} value={r.minQty} onChange={(e) => update(i, { minQty: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className="h-9 text-right" aria-label={`SL tối thiểu ${r.sku}`} /></td>
                  <td className="py-2 pr-2"><Input value={r.breaks} onChange={(e) => update(i, { breaks: e.target.value })} className="h-9" placeholder="24:95000; 48:90000" aria-label={`Bậc giá ${r.sku}`} /></td>
                  <td><Button variant="ghost" size="sm" aria-label={`Bỏ ${r.sku}`} onClick={() => { setRemoved((x) => [...x, r.productId]); setRows((rs) => rs.filter((_, k) => k !== i)); }}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
