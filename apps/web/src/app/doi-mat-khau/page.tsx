import Image from 'next/image';
import { requireUser } from '@/lib/session';
import { ChangePasswordForm } from './change-password-form';

export const metadata = { title: 'Đổi mật khẩu' };

/** Forced after an Owner/Manager password reset (SPEC 6.1); also reachable from the profile. */
export default async function ChangePasswordPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image src="/brand/logo.png" alt="Michio" width={180} height={69} priority className="h-auto w-44" />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="-mx-6 -mt-6 mb-6 h-1 rounded-t-2xl bg-brand-green" aria-hidden />
          <h1 className="mb-1 text-xl font-semibold">Đổi mật khẩu</h1>
          <p className="mb-5 text-sm text-muted-foreground">
            {user.mustChangePassword ? 'Bạn đang dùng mật khẩu tạm. Hãy đặt mật khẩu mới để tiếp tục.' : `Tài khoản ${user.email}`}
          </p>
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  );
}
