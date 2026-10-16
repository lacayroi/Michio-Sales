import Image from 'next/image';
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/components/change-password-form';
import { getCurrentUser } from '@/lib/session';

export const metadata = { title: 'Đổi mật khẩu' };

/** Forced after an Owner/Manager reset (SPEC 6.1). Lives outside the app layout to avoid a redirect loop. */
export default async function ForcedPasswordChangePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.mustChangePassword) redirect('/ho-so');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/brand/logo.png" alt="Michio" width={180} height={69} priority className="h-auto w-44" />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="-mx-6 -mt-6 mb-6 h-1 rounded-t-2xl bg-brand-green" aria-hidden />
          <h1 className="mb-1 text-xl font-semibold">Đặt mật khẩu mới</h1>
          <p className="mb-5 text-sm text-muted-foreground">Xin chào {user.fullName}, bạn đang dùng mật khẩu tạm. Hãy đặt mật khẩu mới để tiếp tục.</p>
          <ChangePasswordForm forced redirectTo="/" />
        </div>
      </div>
    </main>
  );
}
