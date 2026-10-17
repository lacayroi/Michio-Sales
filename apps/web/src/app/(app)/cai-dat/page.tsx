import { can } from '@michio/auth/permissions';
import { Bot, CalendarDays, Clock, Facebook, KeyRound, MessageSquareText, SplitSquareHorizontal } from 'lucide-react';
import Link from 'next/link';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Cài đặt & Tích hợp' };

export default async function SettingsPage() {
  const user = await requireUser('settings.manage', 'integration.manage');
  const items = [
    can(user.role, 'settings.manage') && { href: '/cai-dat/gio-lam-viec', icon: Clock, title: 'Giờ làm việc', desc: 'Khung giờ T2–T7 dùng để tính thời hạn nhận và liên hệ lead' },
    can(user.role, 'settings.manage') && { href: '/cai-dat/ngay-le', icon: CalendarDays, title: 'Ngày lễ', desc: 'Lịch nghỉ dùng để tính thời hạn nhận và liên hệ lead' },
    can(user.role, 'assignmentRule.manage') && { href: '/chia-lead', icon: SplitSquareHorizontal, title: 'Chia lead & thời hạn', desc: 'Luật xoay vòng, thời hạn nhận, lead ngoài giờ' },
    can(user.role, 'integration.manage') && { href: '/cai-dat/api-key', icon: KeyRound, title: 'API key website', desc: 'Kết nối form "Nhận bảng giá sỉ" / "Đăng ký đại lý" trên WordPress' },
    can(user.role, 'settings.manage') && { href: '/cai-dat/mau-tra-loi', icon: MessageSquareText, title: 'Mẫu trả lời nhanh', desc: 'Câu trả lời gõ / trong hộp thư, có biến tên khách, tên sales' },
    can(user.role, 'integration.manage') && { href: '/cai-dat/facebook', icon: Facebook, title: 'Facebook Page', desc: 'Messenger & Lead Ads vào hộp thư, khung thời gian nhắn tin' },
    can(user.role, 'integration.manage') && { href: '/cai-dat/zalo-bot', icon: Bot, title: 'Zalo Bot', desc: 'Bot báo lead, nhắc việc, tổng kết sáng cho sales' },
  ].filter(Boolean) as { href: string; icon: typeof CalendarDays; title: string; desc: string }[];
  return (
    <section className="max-w-3xl">
      <h1 className="mb-5 text-2xl font-semibold">Cài đặt & Tích hợp</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex h-full gap-3 rounded-xl border border-border bg-surface p-4 hover:bg-muted">
              <i.icon className="size-5 shrink-0 text-brand-green" aria-hidden />
              <span>
                <span className="block font-medium">{i.title}</span>
                <span className="text-sm text-muted-foreground">{i.desc}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
