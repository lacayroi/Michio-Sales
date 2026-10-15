import Image from 'next/image';
import { LoginForm } from './login-form';

export const metadata = { title: 'Đăng nhập' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only allow same-site relative redirects.
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Image src="/brand/logo.png" alt="Michio — Japanese Consumables" width={242} height={93} priority className="h-auto w-56" />
          <p className="text-sm font-medium text-muted-foreground">Sales Hub · Quản lý khách sỉ</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="-mx-6 -mt-6 mb-6 h-1 rounded-t-2xl bg-brand-green" aria-hidden />
          <h1 className="mb-5 text-xl font-semibold">Đăng nhập</h1>
          <LoginForm next={safeNext} />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Michio Việt Nam · Hotline 0246.68.56.986</p>
      </div>
    </main>
  );
}
