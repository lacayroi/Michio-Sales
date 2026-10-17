'use client';

import { formatVnd } from '@michio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type DragEvent, useState } from 'react';
import { PriorityBadge } from '@/components/badges';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface Card {
  key: string;
  dealId: string | null;
  leadId: string;
  leadCode: number;
  title: string;
  customerId: string;
  customerName: string;
  ownerName: string | null;
  amount: number;
  priority: string;
  closedAt: string | null;
  lostReason: string | null;
}
interface Column { id: string; code: string; name: string; probability: number; isWon: boolean; isLost: boolean; amount: number; cards: Card[] }

interface Props {
  columns: Column[];
  lostReasons: { id: string; name: string }[];
  canMove: boolean;
  sales: { id: string; fullName: string }[];
  filters: { ownerId: string; q: string; view: 'board' | 'table' };
}

export function Board(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [dragging, setDragging] = useState<Card | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [losing, setLosing] = useState<Card | null>(null);
  const [reason, setReason] = useState(p.lostReasons[0]?.id ?? '');
  const [note, setNote] = useState('');

  async function move(card: Card, col: Column, extra: { lostReasonId?: string; note?: string } = {}) {
    try {
      await api(`/api/v1/deals/${card.key}/stage`, { body: { stage: col.code, ...extra } });
      toast(`${card.customerName} → ${col.name}`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không chuyển được', 'error');
    }
  }

  function drop(col: Column, e: DragEvent) {
    e.preventDefault();
    setOver(null);
    const card = dragging;
    setDragging(null);
    if (!card || card.closedAt) return;
    if (col.isWon) {
      // SPEC 6.5: "Sang CHOT → tạo Đơn sỉ" — recording the order closes the deal as won.
      router.push(`/don-hang/moi?customerId=${card.customerId}${card.dealId ? `&dealId=${card.dealId}` : ''}`);
      return;
    }
    if (col.isLost) {
      setLosing(card);
      return;
    }
    void move(card, col);
  }

  const lostCol = p.columns.find((c) => c.isLost);
  const qs = (over: Record<string, string>) => `/pipeline?${new URLSearchParams({ ...p.filters, ...over })}`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <form className="flex flex-wrap items-center gap-2" action="/pipeline">
          <input type="hidden" name="view" value={p.filters.view} />
          <Input name="q" defaultValue={p.filters.q} placeholder="Tìm khách" className="h-10 w-44" aria-label="Tìm khách" />
          {p.sales.length > 0 && (
            <Select name="ownerId" defaultValue={p.filters.ownerId} className="w-44" aria-label="Sales">
              <option value="">Mọi sales</option>
              {p.sales.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </Select>
          )}
          <button type="submit" className={buttonVariants({ variant: 'outline' })}>Lọc</button>
          <Link href={qs({ view: p.filters.view === 'board' ? 'table' : 'board' })} className={buttonVariants({ variant: 'ghost' })}>{p.filters.view === 'board' ? 'Dạng bảng' : 'Dạng Kanban'}</Link>
        </form>
      </div>

      {p.filters.view === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Khách</th><th className="p-3">Giai đoạn</th><th className="p-3">Sales</th><th className="p-3 text-right">Giá trị</th><th className="p-3">Lead</th></tr></thead>
            <tbody className="divide-y divide-border">
              {p.columns.flatMap((c) => c.cards.map((k) => (
                <tr key={k.key}>
                  <td className="p-3"><Link href={`/khach-hang/${k.customerId}`} className="hover:underline">{k.customerName}</Link></td>
                  <td className="p-3">{c.name}{k.lostReason && <span className="text-xs text-muted-foreground"> · {k.lostReason}</span>}</td>
                  <td className="p-3">{k.ownerName ?? '—'}</td>
                  <td className="p-3 text-right tabular-nums">{k.amount ? formatVnd(k.amount) : '—'}</td>
                  <td className="p-3"><Link href={`/leads/${k.leadId}`} className="hover:underline">#{k.leadCode}</Link></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 lg:mx-0 lg:px-0" data-testid="kanban">
          {p.columns.map((col) => (
            <div
              key={col.id}
              onDragOver={(e) => { if (p.canMove) { e.preventDefault(); setOver(col.id); } }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => drop(col, e)}
              className={cn('flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/40', over === col.id && 'ring-2 ring-brand-green')}
              data-testid={`column-${col.code}`}
            >
              <div className={cn('rounded-t-xl border-b border-border px-3 py-2', col.isWon && 'bg-primary/10', col.isLost && 'bg-muted')}>
                <p className="flex items-center justify-between text-sm font-semibold"><span>{col.name}</span><span className="text-muted-foreground">{col.cards.length}</span></p>
                <p className="text-xs text-muted-foreground">{col.probability}% · {formatVnd(col.amount)}</p>
              </div>
              <ul className="flex min-h-24 flex-col gap-2 p-2">
                {col.cards.map((k) => (
                  <li
                    key={k.key}
                    draggable={p.canMove && !k.closedAt}
                    onDragStart={(e) => { setDragging(k); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => setDragging(null)}
                    className={cn('rounded-lg border border-border bg-surface p-2.5 text-sm shadow-sm', p.canMove && !k.closedAt && 'cursor-grab active:cursor-grabbing', k.closedAt && 'opacity-70')}
                    data-testid="deal-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/khach-hang/${k.customerId}`} className="font-medium hover:underline">{k.customerName}</Link>
                      {k.priority === 'HOT' && <PriorityBadge priority="HOT" />}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <Link href={`/leads/${k.leadId}`} className="hover:underline">#{k.leadCode}</Link>
                      {k.ownerName && ` · ${k.ownerName}`}
                      {k.amount ? ` · ${formatVnd(k.amount)}` : ''}
                    </p>
                    {k.lostReason && <p className="mt-1 text-xs text-muted-foreground">{k.lostReason}</p>}
                    {/* Keyboard / touch alternative to drag-and-drop. */}
                    {p.canMove && !k.closedAt && (
                      <Select
                        className="mt-2 h-8 text-xs"
                        value=""
                        aria-label={`Chuyển ${k.customerName} sang giai đoạn`}
                        onChange={(e) => {
                          const col2 = p.columns.find((c) => c.id === e.target.value);
                          if (!col2) return;
                          if (col2.isWon) router.push(`/don-hang/moi?customerId=${k.customerId}${k.dealId ? `&dealId=${k.dealId}` : ''}`);
                          else if (col2.isLost) setLosing(k);
                          else void move(k, col2);
                        }}
                      >
                        <option value="">Chuyển sang…</option>
                        {p.columns.filter((c) => c.id !== col.id).map((c) => <option key={c.id} value={c.id}>{c.isWon ? `${c.name} (tạo đơn)` : c.name}</option>)}
                      </Select>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!losing} onClose={() => setLosing(null)} title="Không thành công">
        <div className="flex flex-col gap-3">
          <Field id="lost-reason" label="Lý do (bắt buộc)">
            <Select id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {p.lostReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field id="lost-note" label="Ghi chú"><Input id="lost-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button onClick={async () => {
            if (losing && lostCol) await move(losing, lostCol, { lostReasonId: reason, note: note || undefined });
            setLosing(null);
            setNote('');
          }}>Xác nhận</Button>
        </div>
      </Dialog>
    </section>
  );
}
