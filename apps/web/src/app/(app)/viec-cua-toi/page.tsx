import { listTasks } from '@michio/core';
import { formatDateTime, TASK_TYPE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';
import { NewTaskButton, TaskRowActions } from './task-actions';

export const metadata = { title: 'Việc của tôi' };

const TABS = [
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'today', label: 'Hôm nay' },
  { key: 'upcoming', label: 'Sắp tới' },
  { key: 'done', label: 'Đã xong' },
] as const;

/** S11 — Quá hạn / Hôm nay / Sắp tới (SPEC 10.2). */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('task.view');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  // Owner/Manager see everyone's tasks via scope; this screen shows their own unless ?mine=0.
  const assigneeId = user.role === 'SALES' || sp.mine === '0' ? undefined : user.id;
  const first = await listTasks(ctx, { bucket: 'overdue', limit: 1, assigneeId });
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? (first.counts.overdue ? 'overdue' : 'today')) as (typeof TABS)[number]['key'];
  const { items, counts } = await listTasks(ctx, { bucket: tab, assigneeId });
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Việc của tôi</h1>
        <NewTaskButton />
      </div>
      <nav className="flex gap-2" aria-label="Nhóm việc">
        {TABS.map((t) => (
          <Link key={t.key} href={`/viec-cua-toi?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined}
            className={cn('rounded-full px-3 py-1.5 text-sm font-medium', tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}>
            {t.label}{t.key !== 'done' && <span className={cn('ml-1 tabular-nums', t.key === 'overdue' && counts.overdue > 0 && tab !== 'overdue' && 'text-accent-text')}>{counts[t.key]}</span>}
          </Link>
        ))}
      </nav>
      <ul className="flex flex-col gap-2" data-testid="task-list">
        {items.length === 0 && <li className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Không có việc nào</li>}
        {items.map((t) => (
          <li key={t.id} id={t.id} className={cn('flex flex-wrap items-start gap-3 rounded-xl border bg-surface p-3', sp.task === t.id ? 'border-brand-green' : 'border-border')}>
            <div className="min-w-0 flex-1">
              <p className={cn('font-medium', t.status !== 'TODO' && 'text-muted-foreground line-through')}>{t.title}</p>
              <p className="text-xs text-muted-foreground">
                V{t.code} · {TASK_TYPE_LABELS[t.type]} · <span className={cn(tab === 'overdue' && 'font-semibold text-accent-text')}>{formatDateTime(t.dueAt)}</span>
                {t.customer && <> · <Link href={`/khach-hang/${t.customer.id}`} className="hover:underline">{t.customer.shopName ?? t.customer.contactName}</Link></>}
                {t.lead && <> · <Link href={`/leads/${t.lead.id}`} className="hover:underline">#{t.lead.code}</Link></>}
                {t.quote && <> · <Link href={`/bao-gia/${t.quote.id}`} className="hover:underline">{t.quote.code}</Link></>}
                {t.assignee.id !== user.id && ` · ${t.assignee.fullName}`}
              </p>
              {t.note && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{t.note}</p>}
            </div>
            {t.status === 'TODO' && <TaskRowActions taskId={t.id} code={t.code} dueAt={t.dueAt.toISOString()} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
