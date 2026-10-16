'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { useToast } from './ui/toast';

const REFRESH_EVENTS = ['lead.assigned', 'lead.updated', 'assignment.expiring', 'notification.new'];

interface NotificationItem { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }

/** SSE subscriber: refreshes server components on relevant events and feeds the bell. */
export function LiveUpdates() {
  const router = useRouter();
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const data = await api<{ items: NotificationItem[]; unread: number }>('/api/v1/notifications');
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* offline: keep last state */
    }
  }, []);

  useEffect(() => {
    void load();
    const es = new EventSource('/api/v1/events/stream');
    const onEvent = (e: MessageEvent) => {
      if (e.type === 'notification.new') {
        void load();
        try {
          const d = JSON.parse(e.data) as { title?: string };
          if (d.title) toast(d.title, 'info');
        } catch {
          /* ignore */
        }
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300); // coalesce bursts
    };
    for (const t of REFRESH_EVENTS) es.addEventListener(t, onEvent);
    return () => {
      clearTimeout(timer.current);
      es.close();
    };
  }, [load, router, toast]);

  async function markAllRead() {
    await api('/api/v1/notifications/read', { body: {} });
    void load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 hover:bg-muted"
        aria-label={unread ? `Thông báo (${unread} chưa đọc)` : 'Thông báo'}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-5 text-accent-foreground" data-testid="unread-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-sm font-semibold">Thông báo</p>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-primary hover:underline dark:text-brand-green">
                Đánh dấu đã đọc
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có thông báo</li>}
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'bg-primary/5'}>
                <Link href={n.link ?? '#'} onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-muted">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
