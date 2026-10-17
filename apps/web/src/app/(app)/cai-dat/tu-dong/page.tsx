import { getSettings } from '@michio/core';
import Link from 'next/link';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { AutomationForm } from './form';

export const metadata = { title: 'Quy tắc tự động' };

const KEYS = [
  'automation.quoteFollowUp', 'automation.reorderReminder', 'automation.staleLead',
  'quote.validDays', 'quote.followUpBusinessDays', 'quote.maxExtraDiscountPct',
  'reorder.defaultCycleDays', 'reorder.remindBeforeDays', 'reorder.dormantDays', 'lead.staleDays',
] as const;

/** SPEC 6.9 "Quy tắc tự động (bật/tắt)" + các ngưỡng [CẦN XÁC NHẬN] ở §7.1. */
export default async function AutomationPage() {
  const user = await requireUser('settings.manage');
  const ctx = serviceContext(user);
  const values = await getSettings(ctx.db, ctx.orgId, [...KEYS]);
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
        <h1 className="mt-1 text-2xl font-semibold">Quy tắc tự động & chăm khách</h1>
        <p className="text-sm text-muted-foreground">Bật/tắt việc tự tạo và đổi các ngưỡng. Có hiệu lực ở lần chạy kế tiếp của job.</p>
      </div>
      <AutomationForm values={values} />
    </section>
  );
}
