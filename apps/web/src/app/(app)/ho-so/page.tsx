import { ROLE_LABELS, toLocalVnPhone } from '@michio/shared';
import { ChangePasswordForm } from '@/components/change-password-form';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Hồ sơ' };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <section className="flex max-w-xl flex-col gap-5">
      <h1 className="text-2xl font-semibold">Hồ sơ</h1>
      <div className="rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="text-lg font-semibold">{user.fullName}</p>
        <p className="text-muted-foreground">{ROLE_LABELS[user.role]} · {user.email}{user.phone && ` · ${toLocalVnPhone(user.phone)}`}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Đổi mật khẩu</h2>
        <ChangePasswordForm />
      </div>
      <p className="text-sm text-muted-foreground">Kết nối Zalo Bot, cài đặt thông báo và lịch nghỉ có ở giai đoạn M2.</p>
    </section>
  );
}
