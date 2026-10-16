import { getSetting } from '@michio/core';
import { prisma } from '@michio/db';
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { HolidayEditor } from './holiday-editor';

export const metadata = { title: 'Ngày lễ' };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requireUser('settings.manage');
  const sp = await searchParams;
  const current = new Date().getFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= 2100 ? Number(sp.year) : current;
  const [items, confirmed] = await Promise.all([
    prisma.holiday.findMany({ where: { orgId: user.orgId, date: { gte: new Date(`${year}-01-01T00:00:00Z`), lt: new Date(`${year + 1}-01-01T00:00:00Z`) } }, orderBy: { date: 'asc' } }),
    getSetting(prisma, user.orgId, 'calendar.holidaysConfirmedYears'),
  ]);
  return (
    <section className="max-w-2xl">
      <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
      <h1 className="mb-1 mt-1 text-2xl font-semibold">Ngày lễ {year}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Michio làm việc Thứ Hai – Thứ Bảy, nghỉ Chủ nhật. Ngày trong danh sách không tính vào thời hạn nhận / liên hệ lead.
        Tết Âm lịch và ngày nghỉ liền kề Quốc khánh được seed theo phương án khu vực nhà nước — hãy chỉnh theo lịch thực tế của công ty rồi bấm xác nhận.
      </p>
      <div className="mb-4 flex gap-2 text-sm">
        {[current, current + 1].map((y) => (
          <Link key={y} href={`?year=${y}`} className={`rounded-lg px-3 py-1.5 ${y === year ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>{y}</Link>
        ))}
      </div>
      <HolidayEditor year={year} confirmed={confirmed.includes(year)} items={items.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name }))} />
    </section>
  );
}
