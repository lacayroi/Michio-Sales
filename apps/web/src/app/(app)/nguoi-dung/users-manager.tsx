'use client';

import { formatDate, formatDateTime, ROLE_LABELS, toLocalVnPhone, USER_STATUS_LABELS } from '@michio/shared';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, fieldErrors } from '@/lib/client';
import { cn } from '@/lib/utils';

type Role = keyof typeof ROLE_LABELS;
type Status = keyof typeof USER_STATUS_LABELS;

export interface UserView {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  role: Role;
  status: Status;
  maxOpenLeads: number;
  openLeads: number;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  botLinked: boolean;
  leaves: { id: string; startAt: string; endAt: string; reason: string | null }[];
}

type Modal = { kind: 'create' } | { kind: 'edit'; user: UserView } | { kind: 'leave'; user: UserView } | { kind: 'password'; user: UserView; password: string } | null;

export function UsersManager({ users, currentUserId, canManage, viewerRole }: { users: UserView[]; currentUserId: string; canManage: boolean; viewerRole: Role }) {
  const router = useRouter();
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function close() {
    setModal(null);
    setError(null);
    setErrors({});
  }

  async function call<T>(url: string, init: { method?: string; body?: unknown }) {
    setBusy(true);
    setError(null);
    setErrors({});
    const res = await api<T>(url, init);
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message ?? null);
      setErrors(fieldErrors(res.error));
      return null;
    }
    router.refresh();
    return res.data;
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = await call<{ user: UserView; tempPassword: string }>('/api/v1/users', {
      body: { email: f.get('email'), fullName: f.get('fullName'), phone: f.get('phone') || null, role: f.get('role'), maxOpenLeads: Number(f.get('maxOpenLeads')) },
    });
    if (data) setModal({ kind: 'password', user: data.user, password: data.tempPassword });
  }

  async function update(e: FormEvent<HTMLFormElement>, u: UserView) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await call(`/api/v1/users/${u.id}`, {
      method: 'PATCH',
      body: { fullName: f.get('fullName'), email: f.get('email'), phone: f.get('phone') || null, role: f.get('role'), status: f.get('status'), maxOpenLeads: Number(f.get('maxOpenLeads')) },
    });
    if (ok) close();
  }

  async function resetPassword(u: UserView) {
    if (!confirm(`Đặt lại mật khẩu cho ${u.fullName}? Mật khẩu cũ sẽ không dùng được nữa.`)) return;
    const data = await call<{ tempPassword: string }>(`/api/v1/users/${u.id}/reset-password`, { body: {} });
    if (data) setModal({ kind: 'password', user: u, password: data.tempPassword });
  }

  async function addLeave(e: FormEvent<HTMLFormElement>, u: UserView) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // Whole days in Vietnam time: from 00:00 of the first day to 00:00 after the last day.
    const start = new Date(`${f.get('start')}T00:00:00+07:00`);
    const end = new Date(new Date(`${f.get('end')}T00:00:00+07:00`).getTime() + 86_400_000);
    const ok = await call(`/api/v1/users/${u.id}/leaves`, { body: { startAt: start.toISOString(), endAt: end.toISOString(), reason: f.get('reason') || null } });
    if (ok) close();
  }

  async function removeLeave(u: UserView, leaveId: string) {
    await call(`/api/v1/users/${u.id}/leaves/${leaveId}`, { method: 'DELETE' });
    close();
  }

  const roleOptions = (Object.keys(ROLE_LABELS) as Role[]).map((r) => (
    <option key={r} value={r}>
      {ROLE_LABELS[r]}
    </option>
  ));

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <Button onClick={() => setModal({ kind: 'create' })} className="self-start">
          <Plus className="size-4" /> Thêm người dùng
        </Button>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs font-semibold text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2">Họ tên</th>
              <th className="px-3 py-2">Vai trò</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="hidden px-3 py-2 md:table-cell">Lead mở</th>
              <th className="hidden px-3 py-2 lg:table-cell">Đăng nhập gần nhất</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={cn('border-b border-border last:border-0', u.status === 'INACTIVE' && 'opacity-60')} data-testid="user-row">
                <td className="px-3 py-2">
                  <p className="font-medium">{u.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.email}
                    {u.phone ? ` · ${toLocalVnPhone(u.phone)}` : ''}
                  </p>
                  {u.leaves.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Nghỉ: {u.leaves.map((l) => `${formatDate(new Date(l.startAt))}–${formatDate(new Date(new Date(l.endAt).getTime() - 1))}`).join(', ')}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">{ROLE_LABELS[u.role]}</td>
                <td className="px-3 py-2">
                  {USER_STATUS_LABELS[u.status]}
                  {u.mustChangePassword && <span className="block text-xs text-muted-foreground">chờ đổi mật khẩu</span>}
                </td>
                <td className="hidden px-3 py-2 tabular-nums md:table-cell">
                  {u.role === 'SALES' ? `${u.openLeads}/${u.maxOpenLeads}` : '—'}
                </td>
                <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">{u.lastLoginAt ? formatDateTime(new Date(u.lastLoginAt)) : 'Chưa đăng nhập'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {canManage && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setModal({ kind: 'edit', user: u })}>
                          Sửa
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'leave', user: u })}>
                          Lịch nghỉ
                        </Button>
                      </>
                    )}
                    {u.id !== currentUserId && u.status !== 'INACTIVE' && (u.role !== 'OWNER' || viewerRole === 'OWNER') && (
                      <Button size="sm" variant="ghost" onClick={() => resetPassword(u)} disabled={busy}>
                        Đặt lại mật khẩu
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!modal && <FormError message={error} />}

      <Dialog open={modal?.kind === 'create'} onClose={close} title="Thêm người dùng">
        <form onSubmit={create} className="flex flex-col gap-3" noValidate>
          <Field label="Họ tên" htmlFor="c-fullName" error={errors.fullName}>
            <Input id="c-fullName" name="fullName" required />
          </Field>
          <Field label="Email đăng nhập" htmlFor="c-email" error={errors.email}>
            <Input id="c-email" name="email" type="email" required />
          </Field>
          <Field label="Số điện thoại (đăng nhập bằng SĐT)" htmlFor="c-phone" error={errors.phone}>
            <Input id="c-phone" name="phone" type="tel" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vai trò" htmlFor="c-role">
              <Select id="c-role" name="role" defaultValue="SALES">
                {roleOptions}
              </Select>
            </Field>
            <Field label="Số lead mở tối đa" htmlFor="c-max">
              <Input id="c-max" name="maxOpenLeads" type="number" min={1} max={1000} defaultValue={40} />
            </Field>
          </div>
          <FormError message={error} />
          <Button type="submit" disabled={busy}>
            Tạo tài khoản
          </Button>
        </form>
      </Dialog>

      <Dialog open={modal?.kind === 'edit'} onClose={close} title="Sửa người dùng">
        {modal?.kind === 'edit' && (
          <form onSubmit={(e) => update(e, modal.user)} className="flex flex-col gap-3" noValidate>
            <Field label="Họ tên" htmlFor="e-fullName" error={errors.fullName}>
              <Input id="e-fullName" name="fullName" defaultValue={modal.user.fullName} required />
            </Field>
            <Field label="Email" htmlFor="e-email" error={errors.email}>
              <Input id="e-email" name="email" type="email" defaultValue={modal.user.email} required />
            </Field>
            <Field label="Số điện thoại" htmlFor="e-phone" error={errors.phone}>
              <Input id="e-phone" name="phone" type="tel" defaultValue={modal.user.phone ? toLocalVnPhone(modal.user.phone) : ''} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vai trò" htmlFor="e-role">
                <Select id="e-role" name="role" defaultValue={modal.user.role} disabled={modal.user.id === currentUserId}>
                  {roleOptions}
                </Select>
              </Field>
              <Field label="Trạng thái" htmlFor="e-status" hint="Đã nghỉ việc = khóa đăng nhập ngay">
                <Select id="e-status" name="status" defaultValue={modal.user.status} disabled={modal.user.id === currentUserId}>
                  {(Object.keys(USER_STATUS_LABELS) as Status[]).map((s) => (
                    <option key={s} value={s}>
                      {USER_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Số lead mở tối đa" htmlFor="e-max">
              <Input id="e-max" name="maxOpenLeads" type="number" min={1} max={1000} defaultValue={modal.user.maxOpenLeads} />
            </Field>
            {modal.user.id === currentUserId && (
              <>
                <input type="hidden" name="role" value={modal.user.role} />
                <input type="hidden" name="status" value={modal.user.status} />
              </>
            )}
            <FormError message={error} />
            <Button type="submit" disabled={busy}>
              Lưu
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog open={modal?.kind === 'leave'} onClose={close} title={modal?.kind === 'leave' ? `Lịch nghỉ — ${modal.user.fullName}` : 'Lịch nghỉ'}>
        {modal?.kind === 'leave' && (
          <div className="flex flex-col gap-4">
            {modal.user.leaves.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {modal.user.leaves.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {formatDate(new Date(l.startAt))} – {formatDate(new Date(new Date(l.endAt).getTime() - 1))}
                      {l.reason ? ` · ${l.reason}` : ''}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => removeLeave(modal.user, l.id)}>
                      Xóa
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={(e) => addLeave(e, modal.user)} className="grid grid-cols-2 gap-3">
              <Field label="Từ ngày" htmlFor="l-start">
                <Input id="l-start" name="start" type="date" required />
              </Field>
              <Field label="Đến hết ngày" htmlFor="l-end">
                <Input id="l-end" name="end" type="date" required />
              </Field>
              <Field label="Lý do" htmlFor="l-reason" className="col-span-2">
                <Input id="l-reason" name="reason" />
              </Field>
              <p className="col-span-2 text-xs text-muted-foreground">Trong thời gian nghỉ, người này không được chia lead mới.</p>
              <div className="col-span-2 flex flex-col gap-2">
                <FormError message={error} />
                <Button type="submit" disabled={busy}>
                  Thêm lịch nghỉ
                </Button>
              </div>
            </form>
          </div>
        )}
      </Dialog>

      <Dialog open={modal?.kind === 'password'} onClose={close} title="Mật khẩu tạm">
        {modal?.kind === 'password' && (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-sm">
              Gửi mật khẩu tạm này cho <b>{modal.user.fullName}</b>. Người dùng phải đổi mật khẩu ở lần đăng nhập tới. Mật khẩu chỉ hiển thị một lần.
            </p>
            <p className="rounded-lg bg-muted px-3 py-3 text-center font-mono text-xl font-semibold tracking-wider select-all" data-testid="temp-password">
              {modal.password}
            </p>
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(modal.password)}>
              Sao chép
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
