'use client';

import { CheckCircle2, Pencil, Send, ShoppingCart, ThumbsDown, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

interface Props {
  quoteId: string;
  code: string;
  status: string;
  can: { edit: boolean; approve: boolean; send: boolean; respond: boolean; toOrder: boolean };
  messenger: { id: string; name: string; ok: boolean; reason: string | null }[];
  address: string | null;
}

export function QuoteActions(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [conversationId, setConversationId] = useState(p.messenger.find((m) => m.ok)?.id ?? '');
  const [payment, setPayment] = useState('BANK_TRANSFER');
  const [address, setAddress] = useState(p.address ?? '');

  async function run<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try {
      const r = await fn();
      toast(ok);
      router.refresh();
      return r;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thao tác thất bại', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const resend = p.status === 'SENT';
  return (
    <div className="flex flex-wrap gap-2" data-testid="quote-actions">
      {p.can.edit && <Link href={`/bao-gia/${p.quoteId}/sua`} className={buttonVariants({ variant: 'outline' })}><Pencil className="size-4" />Sửa</Link>}
      {p.can.approve && <Button disabled={busy} onClick={() => run(() => api(`/api/v1/quotes/${p.quoteId}/approve`, { body: {} }), 'Đã duyệt báo giá')}><CheckCircle2 className="size-4" />Duyệt chiết khấu</Button>}
      {p.can.send && p.status !== 'PENDING_APPROVAL' && <Button disabled={busy} onClick={() => setSendOpen(true)}><Send className="size-4" />{resend ? 'Gửi lại' : 'Gửi báo giá'}</Button>}
      {p.can.respond && (
        <>
          <Button variant="outline" disabled={busy} onClick={() => run(() => api(`/api/v1/quotes/${p.quoteId}/accept`, { body: {} }), 'Đã ghi nhận khách đồng ý')}><ThumbsUp className="size-4" />Khách đồng ý</Button>
          <Button variant="outline" disabled={busy} onClick={() => {
            const reason = window.prompt('Lý do khách từ chối?') ?? undefined;
            if (reason !== undefined) void run(() => api(`/api/v1/quotes/${p.quoteId}/reject`, { body: { reason } }), 'Đã ghi nhận khách từ chối');
          }}><ThumbsDown className="size-4" />Khách từ chối</Button>
        </>
      )}
      {p.can.toOrder && <Button disabled={busy} onClick={() => setOrderOpen(true)}><ShoppingCart className="size-4" />Chuyển thành đơn</Button>}

      <Dialog open={sendOpen} onClose={() => setSendOpen(false)} title={`Gửi báo giá ${p.code}`}>
        <div className="flex flex-col gap-4 text-sm">
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 font-medium">Gửi PDF qua Messenger</p>
            {p.messenger.length === 0 ? (
              <p className="text-muted-foreground">Khách chưa nhắn Page Facebook.</p>
            ) : (
              <>
                <Select value={conversationId} onChange={(e) => setConversationId(e.target.value)} aria-label="Hội thoại Messenger">
                  {p.messenger.map((m) => <option key={m.id} value={m.id} disabled={!m.ok}>{m.name}{m.ok ? '' : ' — hết khung nhắn'}</option>)}
                </Select>
                {p.messenger.every((m) => !m.ok) && <p className="mt-1 text-xs text-accent-text">{p.messenger[0]?.reason}</p>}
                <Button className="mt-2 w-full" disabled={busy || !conversationId} onClick={async () => {
                  if (await run(() => api(`/api/v1/quotes/${p.quoteId}/send`, { body: { via: 'MESSENGER', conversationId } }), 'Đã gửi — PDF sẽ đến khách trong giây lát')) setSendOpen(false);
                }}>Gửi qua Messenger</Button>
              </>
            )}
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 font-medium">Tự gửi qua Zalo / email</p>
            <p className="mb-2 text-muted-foreground">Đánh dấu đã gửi và tải PDF về máy.</p>
            <Button variant="outline" className="w-full" disabled={busy} onClick={async () => {
              if (await run(() => api(`/api/v1/quotes/${p.quoteId}/send`, { body: { via: 'MANUAL' } }), 'Đã đánh dấu gửi')) {
                setSendOpen(false);
                window.location.href = `/api/v1/quotes/${p.quoteId}/pdf?download=1`;
              }
            }}>Đánh dấu đã gửi & tải PDF</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={orderOpen} onClose={() => setOrderOpen(false)} title="Chuyển báo giá thành đơn sỉ">
        <div className="flex flex-col gap-3">
          <Field id="o-pay" label="Phương thức thanh toán">
            <Select id="o-pay" value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option><option value="CREDIT">Công nợ</option>
            </Select>
          </Field>
          <Field id="o-addr" label="Địa chỉ giao"><Input id="o-addr" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Button disabled={busy} onClick={async () => {
            const order = await run(() => api<{ id: string; code: string }>(`/api/v1/quotes/${p.quoteId}/to-order`, { body: { paymentMethod: payment, shippingAddress: address || undefined } }), 'Đã tạo đơn sỉ');
            if (order) router.push(`/don-hang/${order.id}`);
          }}>Tạo đơn</Button>
        </div>
      </Dialog>
    </div>
  );
}
