import { listQuickReplies } from '@michio/core';
import Link from 'next/link';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { QuickReplyEditor } from './editor';

export const metadata = { title: 'Mẫu trả lời nhanh' };

export default async function QuickRepliesPage() {
  const user = await requireUser('settings.manage');
  const items = await listQuickReplies(serviceContext(user));
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
        <h1 className="mt-1 text-2xl font-semibold">Mẫu trả lời nhanh</h1>
        <p className="text-sm text-muted-foreground">
          Trong hộp thư gõ <kbd className="rounded bg-muted px-1">/</kbd> + phím tắt để chèn. Biến: <code>{'{ten_khach}'}</code>, <code>{'{ten_sales}'}</code>, <code>{'{sdt_sales}'}</code>.
        </p>
      </div>
      <QuickReplyEditor items={items.map((q) => ({ id: q.id, shortcut: q.shortcut, content: q.content }))} />
    </section>
  );
}
