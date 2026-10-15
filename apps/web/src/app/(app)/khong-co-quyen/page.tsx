import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: 'Không có quyền truy cập' };

export default function ForbiddenPage() {
  return (
    <section className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <ShieldAlert className="size-10 text-accent-text" aria-hidden />
      <h1 className="text-xl font-semibold">Bạn không có quyền xem trang này</h1>
      <p className="text-sm text-muted-foreground">Nếu cần truy cập, vui lòng liên hệ chủ doanh nghiệp để được cấp quyền.</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        Về trang chủ
      </Link>
    </section>
  );
}
