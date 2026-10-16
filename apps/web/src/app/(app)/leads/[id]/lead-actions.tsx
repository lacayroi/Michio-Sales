'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/client';

type Mode = null | 'return' | 'assign' | 'lost';

/** Nhận / Trả lại (SALES), Giao·chuyển (Owner/Manager), Đóng – không thành công. Big buttons for phones (S2/S5). */
export function LeadActions({
  leadId,
  canAccept,
  canReturn,
  assignees,
  lostReasons,
  canDelete,
}: {
  leadId: string;
  canAccept: boolean;
  canReturn: boolean;
  assignees: { id: string; fullName: string }[] | null;
  lostReasons: { id: string; name: string }[] | null;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(url: string, body: unknown, done: string, method?: string) {
    setBusy(true);
    setError(null);
    const res = await api<{ outcome?: { kind: string; userName?: string }; kind?: string; userName?: string }>(url, { body, method });
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message ?? null);
      return false;
    }
    const outcome = res.data?.outcome ?? res.data;
    setInfo(outcome?.kind === 'ASSIGNED' && outcome.userName ? `${done} → ${outcome.userName}` : outcome?.kind === 'QUEUED' ? `${done} — lead vào hàng chờ` : done);
    setMode(null);
    router.refresh();
    return true;
  }

  const submitReturn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get('reason');
    void run(`/api/v1/leads/${leadId}/return`, { reason: reason || null }, 'Đã trả lại lead');
  };
  const submitAssign = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const to = String(new FormData(e.currentTarget).get('to'));
    void run(`/api/v1/leads/${leadId}/assign`, to === 'auto' ? { auto: true } : { userId: to }, 'Đã giao lead');
  };
  const submitLost = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(`/api/v1/leads/${leadId}`, { status: 'LOST', lostReasonId: f.get('lostReasonId'), lostNote: f.get('lostNote') || null }, 'Đã đóng lead', 'PATCH');
  };
  async function remove() {
    if (!confirm('Xóa lead này? (xóa mềm, vẫn còn trong audit log)')) return;
    const res = await api(`/api/v1/leads/${leadId}`, { method: 'DELETE' });
    if (!res.ok) return setError(res.error?.message ?? null);
    router.replace('/leads');
  }

  if (!canAccept && !canReturn && !assignees && !lostReasons && !canDelete) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <Button size="lg" disabled={busy} onClick={() => run(`/api/v1/leads/${leadId}/accept`, {}, 'Đã nhận lead')} className="min-w-32 flex-1 sm:flex-none">
            Nhận lead
          </Button>
        )}
        {canReturn && (
          <Button size="lg" variant="outline" disabled={busy} onClick={() => setMode('return')} className="min-w-32 flex-1 sm:flex-none">
            Trả lại
          </Button>
        )}
        {assignees && (
          <Button variant="outline" disabled={busy} onClick={() => setMode('assign')}>
            Giao / chuyển
          </Button>
        )}
        {lostReasons && (
          <Button variant="ghost" disabled={busy} onClick={() => setMode('lost')}>
            Không thành công
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" disabled={busy} onClick={remove} className="text-accent-text">
            Xóa
          </Button>
        )}
      </div>
      <FormError message={error} />
      {info && (
        <p role="status" className="text-sm font-medium text-primary">
          {info}
        </p>
      )}

      <Dialog open={mode === 'return'} onClose={() => setMode(null)} title="Trả lại lead">
        <form onSubmit={submitReturn} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Lead sẽ được chia cho sales kế tiếp; bạn sẽ không nhận lại lead này.</p>
          <Field label="Lý do (không bắt buộc)" htmlFor="reason">
            <Input id="reason" name="reason" placeholder="Không đúng khu vực, trùng khách…" />
          </Field>
          <Button type="submit" disabled={busy}>
            Trả lại
          </Button>
        </form>
      </Dialog>

      <Dialog open={mode === 'assign'} onClose={() => setMode(null)} title="Giao / chuyển lead">
        <form onSubmit={submitAssign} className="flex flex-col gap-3">
          <Field label="Giao cho" htmlFor="to">
            <Select id="to" name="to" required defaultValue="">
              <option value="" disabled>
                Chọn người nhận…
              </option>
              <option value="auto">Chia tự động theo luật</option>
              {assignees?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={busy}>
            Giao
          </Button>
        </form>
      </Dialog>

      <Dialog open={mode === 'lost'} onClose={() => setMode(null)} title="Đóng lead — không thành công">
        <form onSubmit={submitLost} className="flex flex-col gap-3">
          <Field label="Lý do" htmlFor="lostReasonId">
            <Select id="lostReasonId" name="lostReasonId" required defaultValue="">
              <option value="" disabled>
                Chọn lý do…
              </option>
              {lostReasons?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ghi chú" htmlFor="lostNote">
            <Textarea id="lostNote" name="lostNote" />
          </Field>
          <Button type="submit" disabled={busy}>
            Đóng lead
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
