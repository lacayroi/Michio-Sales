import { can } from '@michio/auth/permissions';
import { listUsers } from '@michio/core';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { UsersTable } from './users-table';

export const metadata = { title: 'Người dùng' };

export default async function UsersPage() {
  const user = await requireUser('user.manage', 'user.resetPassword');
  const users = await listUsers(serviceContext(user));
  return (
    <section className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold">Người dùng</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {can(user.role, 'user.manage') ? 'Tạo tài khoản, phân quyền, khóa tài khoản và đặt lại mật khẩu.' : 'Đặt lại mật khẩu cho nhân viên quên mật khẩu.'}
      </p>
      <UsersTable
        me={{ id: user.id, role: user.role }}
        canManage={can(user.role, 'user.manage')}
        users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))}
      />
    </section>
  );
}
