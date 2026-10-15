'use client';

import { formatDateTime, ROLE_LABELS, toLocalVnPhone, USER_STATUS_LABELS } from '@michio/shared';
import { Copy, KeyRound, Pencil, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

type Role = keyof typeof ROLE_LABELS;
interface Row {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  role: Role;
  status: keyof typeof USER_STATUS_LABELS;
  maxOpenLeads: number;
  openLeads: number;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  zaloLinked: boolean;
}

const RANK: Record<Role, number> = { OWNER: 3, MANAGER: 2, SALES: 1, SUPPORT: 1, VIEWER: 1 };

export function UsersTable({ users, me, canManage }: { users: Row[]; me: { id: string; role: Role }; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [secret, setSecret] = useState<{ name: string; email: string; password: string; created: boolean } | null>(null);
  const [resetting, setResetting] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const canReset = (u: Row) => u.id !== me.id && u.status !== 'INACTIVE' && (me.role === 'OWNER' || RANK[u.role] < RANK[me.role]);

  async function doReset() {
    if (!resetting) return;
    setBusy(true);
    try {
      const r = await api<{ tempPassword: string }>(`/api/v1/users/${resetting.id}/reset-password`, { body: {} });
      setSecret({ name: resetting.fullName, email: resetting.email, password: r.tempPassword, created: false });
      setResetting(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không đặt lại được', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div>
          <Button onClick={() => setEditing('new')}><UserPlus className="size-4" aria-hidden />Thêm người dùng</Button>
        </div>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface" data-testid="users">
        {users.map((u) => (
          <li key={u.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${u.status === 'INACTIVE' ? 'opacity-60' : ''}`} data-testid="user-row">
            <div className="min-w-0">
              <p className="font-medium">
                {u.fullName} <span className="text-sm font-normal text-muted-foreground">· {ROLE_LABELS[u.role]}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {[u.email, u.phone && toLocalVnPhone(u.phone), USER_STATUS_LABELS[u.status], u.role === 'SALES' && `${u.openLeads}/${u.maxOpenLeads} lead`, u.lastLoginAt ? `Đăng nhập ${formatDateTime(new Date(u.lastLoginAt))}` : 'Chưa đăng nhập', u.mustChangePassword && 'Đang dùng mật khẩu tạm']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex gap-2">
              {canReset(u) && (
                <Button size="sm" variant="outline" onClick={() => setResetting(u)}>
                  <KeyRound className="size-4" aria-hidden />Đặt lại mật khẩu
                </Button>
              )}
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(u)} aria-label={`Sửa ${u.fullName}`}>
                  <Pencil className="size-4" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={resetting !== null} onClose={() => setResetting(null)} title="Đặt lại mật khẩu">
        {resetting && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Tạo mật khẩu tạm cho <strong>{resetting.fullName}</strong>. Mật khẩu hiện tại sẽ ngừng hoạt động; người dùng phải đổi mật khẩu ở lần đăng nhập kế tiếp.
            </p>
            <Button onClick={doReset} disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo mật khẩu tạm'}</Button>
          </div>
        )}
      </Dialog>

      <Dialog open={secret !== null} onClose={() => setSecret(null)} title={secret?.created ? 'Đã tạo tài khoản' : 'Mật khẩu tạm'}>
        {secret && (
          <div className="flex flex-col gap-3 text-sm">
            <p>Gửi cho <strong>{secret.name}</strong> qua Zalo hoặc nói trực tiếp. Mật khẩu chỉ hiện <strong>một lần</strong>.</p>
            <div className="rounded-lg bg-muted p-3 font-mono">
              <p>Đăng nhập: {secret.email}</p>
              <p>Mật khẩu tạm: <strong data-testid="temp-password">{secret.password}</strong></p>
            </div>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(`Đăng nhập Michio Sales Hub: ${secret.email}\nMật khẩu tạm: ${secret.password}\n(Đổi mật khẩu ngay khi đăng nhập)`).then(() => toast('Đã sao chép'))}
            >
              <Copy className="size-4" aria-hidden />Sao chép
            </Button>
          </div>
        )}
      </Dialog>

      {canManage && (
        <UserDialog
          key={editing === 'new' ? 'new' : editing?.id ?? 'none'}
          user={editing === 'new' ? null : editing}
          open={editing !== null}
          isSelf={editing !== 'new' && editing?.id === me.id}
          onClose={() => setEditing(null)}
          onCreated={(s) => setSecret({ ...s, created: true })}
        />
      )}
    </div>
  );
}

function UserDialog({ user, open, isSelf, onClose, onCreated }: { user: Row | null; open: boolean; isSelf: boolean; onClose: () => void; onCreated: (s: { name: string; email: string; password: string }) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      fullName: String(f.get('fullName')),
      phone: String(f.get('phone') ?? '') || null,
      role: f.get('role') ?? undefined,
      maxOpenLeads: Number(f.get('maxOpenLeads')),
      ...(user ? { status: f.get('status') ?? undefined } : { email: String(f.get('email')) }),
    };
    setBusy(true);
    try {
      if (user) {
        await api(`/api/v1/users/${user.id}`, { method: 'PATCH', body: isSelf ? { fullName: body.fullName, phone: body.phone, maxOpenLeads: body.maxOpenLeads } : body });
        toast('Đã lưu');
      } else {
        const r = await api<{ user: { fullName: string; email: string }; tempPassword: string }>('/api/v1/users', { body });
        onCreated({ name: r.user.fullName, email: r.user.email, password: r.tempPassword });
      }
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={user ? `Sửa ${user.fullName}` : 'Thêm người dùng'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field id="u-name" label="Họ tên"><Input id="u-name" name="fullName" defaultValue={user?.fullName ?? ''} required /></Field>
        {!user && <Field id="u-email" label="Email đăng nhập"><Input id="u-email" name="email" type="email" required /></Field>}
        <Field id="u-phone" label="Số điện thoại"><Input id="u-phone" name="phone" inputMode="tel" defaultValue={user?.phone ? toLocalVnPhone(user.phone) : ''} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="u-role" label="Vai trò">
            <Select id="u-role" name="role" defaultValue={user?.role ?? 'SALES'} disabled={isSelf}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field id="u-max" label="Số lead mở tối đa"><Input id="u-max" name="maxOpenLeads" type="number" min={1} defaultValue={user?.maxOpenLeads ?? 40} /></Field>
        </div>
        {user && (
          <Field id="u-status" label="Trạng thái" hint={user.status !== 'INACTIVE' ? '"Đã nghỉ việc" khóa đăng nhập ngay và chuyển các lead đang chờ cho người khác' : undefined}>
            <Select id="u-status" name="status" defaultValue={user.status} disabled={isSelf}>
              {Object.entries(USER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        )}
        <Button type="submit" disabled={busy}>{user ? 'Lưu' : 'Tạo tài khoản'}</Button>
      </form>
    </Dialog>
  );
}
