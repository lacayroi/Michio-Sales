import { getWorkingCalendar } from '@michio/core';
import Link from 'next/link';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { WorkingHoursEditor } from './working-hours-editor';

export const metadata = { title: 'Giờ làm việc' };

export default async function WorkingHoursPage() {
  const user = await requireUser('settings.manage');
  const weekly = await getWorkingCalendar(serviceContext(user));
  return (
    <section className="max-w-2xl">
      <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
      <h1 className="mt-1 mb-1 text-2xl font-semibold">Giờ làm việc</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Thời hạn nhận và liên hệ lead chỉ đếm trong các khung giờ này (bỏ qua nghỉ trưa, buổi tối, ngày nghỉ và ngày lễ). Ngày không bật là ngày nghỉ.
      </p>
      <WorkingHoursEditor initial={weekly} />
    </section>
  );
}
