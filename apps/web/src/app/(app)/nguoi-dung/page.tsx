import { can } from '@michio/auth';
import { listUsers } from '@michio/core';
import { prisma } from '@michio/db';
import { navItem } from '@/lib/nav';
import { requireUser } from '@/lib/session';
import { UsersManager, type UserView } from './users-manager';

const HREF = '/nguoi-dung';
export const metadata = { title: navItem(HREF).label };

export default async function UsersPage() {
  const user = await requireUser('user.view');
  const users = await listUsers(prisma, { orgId: user.orgId, user, via: 'WEB' });
  const views: UserView[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    maxOpenLeads: u.maxOpenLeads,
    openLeads: u._count.ownedLeads,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    mustChangePassword: u.mustChangePassword,
    botLinked: !!u.zaloBotChatId,
    leaves: u.leaves.map((l) => ({ id: l.id, startAt: l.startAt.toISOString(), endAt: l.endAt.toISOString(), reason: l.reason })),
  }));
  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Người dùng</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {can(user.role, 'user.manage') ? 'Tạo, khóa tài khoản, gán vai trò, số lead mở tối đa và lịch nghỉ.' : 'Bạn có thể đặt lại mật khẩu cho nhân viên.'}
      </p>
      <UsersManager users={views} currentUserId={user.id} canManage={can(user.role, 'user.manage')} viewerRole={user.role} />
    </section>
  );
}
