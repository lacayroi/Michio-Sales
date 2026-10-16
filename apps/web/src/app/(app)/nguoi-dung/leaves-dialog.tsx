'use client';

import { formatDate } from '@michio/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client';

interface Leave {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

/** Lịch nghỉ phép (SPEC 6.1): whole days in Vietnam time; nobody on leave is offered leads. */
export function LeavesDialog({ user, onClose }: { user: { id: string; fullName: string } | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Leave[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(null);
    if (user) void api<{ items: Leave[] }>(`/api/v1/users/${user.id}/leaves`).then((r) => setItems(r.items));
  }, [user]);

  async function reload() {
    if (!user) return;
    setItems((await api<{ items: Leave[] }>(`/api/v1/users/${user.id}/leaves`)).items);
    router.refresh();
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    // From 00:00 of the first day to 00:00 after the last day, Vietnam time.
    const startAt = new Date(`${f.get('start')}T00:00:00+07:00`);
    const endAt = new Date(new Date(`${f.get('end')}T00:00:00+07:00`).getTime() + 86_400_000);
    setBusy(true);
    try {
      await api(`/api/v1/users/${user.id}/leaves`, { body: { startAt: startAt.toISOString(), endAt: endAt.toISOString(), reason: String(f.get('reason') ?? '') || undefined } });
      form.reset();
      toast('Đã thêm lịch nghỉ');
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Không thêm được', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!user) return;
    setBusy(true);
    try {
      await api(`/api/v1/users/${user.id}/leaves/${id}`, { method: 'DELETE' });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const now = Date.now();
  return (
    <Dialog open={user !== null} onClose={onClose} title={user ? `Lịch nghỉ — ${user.fullName}` : 'Lịch nghỉ'}>
      <div className="flex flex-col gap-4 text-sm">
        {items === null ? (
          <p className="text-muted-foreground">Đang tải…</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">Chưa có lịch nghỉ.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" data-testid="leaves">
            {items.map((l) => (
              <li key={l.id} className={`flex items-center justify-between gap-2 px-3 py-2 ${new Date(l.endAt).getTime() < now ? 'opacity-60' : ''}`}>
                <span>
                  {formatDate(new Date(l.startAt))} – {formatDate(new Date(new Date(l.endAt).getTime() - 1))}
                  {l.reason ? ` · ${l.reason}` : ''}
                </span>
                <Button size="sm" variant="ghost" onClick={() => remove(l.id)} disabled={busy}>
                  Xóa
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="grid grid-cols-2 gap-3">
          <Field id="leave-start" label="Từ ngày">
            <Input id="leave-start" name="start" type="date" required />
          </Field>
          <Field id="leave-end" label="Đến hết ngày">
            <Input id="leave-end" name="end" type="date" required />
          </Field>
          <div className="col-span-2">
            <Field id="leave-reason" label="Lý do">
              <Input id="leave-reason" name="reason" />
            </Field>
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">Trong thời gian nghỉ, người này không được chia lead mới; lead đang chờ họ nhận được chuyển cho người khác.</p>
          <Button type="submit" disabled={busy} className="col-span-2">
            Thêm lịch nghỉ
          </Button>
        </form>
      </div>
    </Dialog>
  );
}
