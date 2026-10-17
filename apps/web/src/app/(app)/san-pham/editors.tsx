'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

interface ProductEdit { id: string; sku: string; name: string; unit: string | null; unitsPerCase: number | null; showInQuote: boolean }

/** Wholesale fields kept in Michio Hub (SPEC 6.6): pack size, unit, show/hide in quotes, SKU fix-ups. */
export function EditProductButton({ product }: { product: ProductEdit }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState(product.sku);
  const [unit, setUnit] = useState(product.unit ?? '');
  const [perCase, setPerCase] = useState(product.unitsPerCase ? String(product.unitsPerCase) : '');
  const [show, setShow] = useState(product.showInQuote);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/v1/products/${product.id}`, { method: 'PATCH', body: { sku, unit: unit || null, unitsPerCase: perCase ? Number(perCase) : null, showInQuote: show } });
      toast('Đã lưu');
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    }
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Sửa ${product.sku}`}><Pencil className="size-4" /></Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={product.name}>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field id="pe-sku" label="Mã (SKU)"><Input id="pe-sku" value={sku} onChange={(e) => setSku(e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field id="pe-unit" label="Đơn vị bán sỉ"><Input id="pe-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="gói, chai, hộp" /></Field>
            <Field id="pe-case" label="Số đơn vị / thùng"><Input id="pe-case" type="number" min={1} value={perCase} onChange={(e) => setPerCase(e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-4 accent-[var(--primary)]" />Hiện khi báo giá / gửi khách</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Hủy</Button><Button type="submit">Lưu</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export function NewPriceListButton() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [tier, setTier] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const l = await api<{ id: string }>('/api/v1/price-lists', { body: { name, tier: tier.toUpperCase() } });
      router.push(`/san-pham/bang-gia/${l.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tạo được', 'error');
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="size-4" />Thêm bảng giá</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Bảng giá sỉ mới">
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field id="pl-name" label="Tên"><Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sỉ cấp 2" required /></Field>
          <Field id="pl-tier" label="Mã cấp khách" hint="Khách có cấp này dùng bảng giá này (vd SI_1, SI_2, DAI_LY)"><Input id="pl-tier" value={tier} onChange={(e) => setTier(e.target.value)} required /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Hủy</Button><Button type="submit">Tạo</Button></div>
        </form>
      </Dialog>
    </>
  );
}
