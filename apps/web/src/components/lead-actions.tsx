'use client';

import { Check, PhoneCall, Undo2, UserRoundPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/client';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Field } from './ui/field';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';
import { useToast } from './ui/toast';

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      router.refresh();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thao tác thất bại', 'error');
      router.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

/** Big Nhận / Trả buttons (S2) for a lead waiting for the current user. */
export function AcceptReturnButtons({ leadId, code, size = 'lg' }: { leadId: string; code: number; size?: 'md' | 'lg' }) {
  const { busy, run } = useAction();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');

  async function submitReturn(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api(`/api/v1/leads/${leadId}/return`, { body: { reason: reason || undefined } }), `Đã trả lead #${code}`)) setReturning(false);
  }

  return (
    <div className="flex gap-2">
      <Button size={size} className="flex-1" disabled={busy} onClick={() => run(() => api(`/api/v1/leads/${leadId}/accept`, { body: {} }), `Đã nhận lead #${code}`)}>
        <Check className="size-5" aria-hidden />
        Nhận
      </Button>
      <Button size={size} variant="outline" disabled={busy} onClick={() => setReturning(true)}>
        <Undo2 className="size-5" aria-hidden />
        Trả
      </Button>
      <Dialog open={returning} onClose={() => setReturning(false)} title={`Trả lead #${code}`}>
        <form onSubmit={submitReturn} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Lead sẽ được chia cho người kế tiếp và không quay lại bạn.</p>
          <Field id={`reason-${leadId}`} label="Lý do (không bắt buộc)">
            <Textarea id={`reason-${leadId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="vd: không đúng khu vực, đang quá tải" />
          </Field>
          <Button type="submit" variant="outline" disabled={busy}>
            Xác nhận trả lead
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

/** Ghi cuộc gọi / gặp / ghi chú. A CALL or MEETING counts as first contact (SPEC 6.3.4). */
export function LogActivityButton({ leadId }: { leadId: string }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'CALL' | 'MEETING' | 'NOTE'>('CALL');
  const [result, setResult] = useState<'ANSWERED' | 'NO_ANSWER' | 'CALL_BACK'>('ANSWERED');
  const [note, setNote] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => api(`/api/v1/leads/${leadId}/activities`, { body: { type, note: note || undefined, result: type === 'CALL' ? result : undefined } }),
      type === 'NOTE' ? 'Đã ghi chú' : 'Đã ghi nhận liên hệ',
    );
    if (ok) {
      setOpen(false);
      setNote('');
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PhoneCall className="size-4" aria-hidden />
        Ghi cuộc gọi / ghi chú
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Ghi hoạt động">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field id="act-type" label="Loại">
              <Select id="act-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="CALL">Cuộc gọi</option>
                <option value="MEETING">Gặp mặt</option>
                <option value="NOTE">Ghi chú</option>
              </Select>
            </Field>
            {type === 'CALL' && (
              <Field id="act-result" label="Kết quả">
                <Select id="act-result" value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
                  <option value="ANSWERED">Nghe máy</option>
                  <option value="NO_ANSWER">Không nghe</option>
                  <option value="CALL_BACK">Hẹn gọi lại</option>
                </Select>
              </Field>
            )}
          </div>
          <Field id="act-note" label="Nội dung">
            <Textarea id="act-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>
            Lưu
          </Button>
        </form>
      </Dialog>
    </>
  );
}

export interface AssignableUser {
  id: string;
  fullName: string;
  role: string;
  status: string;
  openLeads: number;
  maxOpenLeads: number;
}

/** Giao / chuyển (Owner/Manager, SPEC 6.3.5). Works for one lead or a selection. */
export function AssignButton({ leadIds, users, currentOwnerId, label = 'Giao cho…', onDone }: { leadIds: string[]; users: AssignableUser[]; currentOwnerId?: string | null; label?: string; onDone?: () => void }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const candidates = users.filter((u) => u.status !== 'INACTIVE' && u.id !== currentOwnerId && ['SALES', 'OWNER', 'MANAGER'].includes(u.role));
  const [userId, setUserId] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const name = users.find((u) => u.id === userId)?.fullName ?? '';
    const ok = await run(async () => {
      if (leadIds.length === 1) return api(`/api/v1/leads/${leadIds[0]}/assign`, { body: { userId } });
      const r = await api<{ results: { ok: boolean; error?: string }[] }>('/api/v1/leads/bulk-assign', { body: { leadIds, userId } });
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) throw new Error(`${failed.length}/${r.results.length} lead không giao được: ${failed[0]?.error}`);
    }, leadIds.length === 1 ? `Đã giao cho ${name}` : `Đã giao ${leadIds.length} lead cho ${name}`);
    if (ok) {
      setOpen(false);
      onDone?.();
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={!leadIds.length}>
        <UserRoundPlus className="size-4" aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={leadIds.length > 1 ? `Giao ${leadIds.length} lead` : 'Giao / chuyển lead'}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field id="assign-user" label="Người nhận">
            <Select id="assign-user" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">— Chọn —</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} · {u.openLeads}/{u.maxOpenLeads} lead{u.status !== 'AVAILABLE' ? ` · ${u.status === 'BUSY' ? 'bận' : 'nghỉ'}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-muted-foreground">Người nhận không cần bấm Nhận. Lịch sử giao được lưu trên trang lead.</p>
          <Button type="submit" disabled={busy || !userId}>
            Giao
          </Button>
        </form>
      </Dialog>
    </>
  );
}
