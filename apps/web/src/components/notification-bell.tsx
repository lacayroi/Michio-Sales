'use client';

import { formatDateTime } from '@michio/shared';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface Item {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const REFRESH_EVENTS = ['lead.assigned', 'lead.updated', 'assignment.expiring', 'notification.new'];

/**
 * Bell + live updates (SPEC 6.4/6.12: chuông + SSE). One EventSource per tab; lead events
 * refresh the current server-rendered page (debounced) so lists and countdowns stay current.
 */
export function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<{ title: string; body: string; link?: string } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: Item[]; unread: number }>('/api/v1/notifications?limit=20');
    if (res.ok && res.data) {
      setItems(res.data.items);
      setUnread(res.data.unread);
    }
  }, []);

  useEffect(() => {
    void load();
    const es = new EventSource('/api/v1/events/stream');
    const onEvent = (e: MessageEvent) => {
      if (e.type === 'notification.new') {
        setUnread((n) => n + 1);
        try {
          setToast(JSON.parse(e.data));
        } catch {
          // ignore malformed payloads
        }
        void load();
      }
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 800);
    };
    for (const t of REFRESH_EVENTS) es.addEventListener(t, onEvent);
    return () => es.close();
  }, [load, router]);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function markAll() {
    await api('/api/v1/notifications/read', { body: {} });
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
  }

  async function openItem(item: Item) {
    if (!item.readAt) {
      await api('/api/v1/notifications/read', { body: { ids: [item.id] } });
      setUnread((n) => Math.max(0, n - 1));
    }
    setOpen(false);
  }

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 hover:bg-muted"
        aria-label={unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground" data-testid="unread-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-16 z-40 max-h-[70dvh] overflow-y-auto rounded-xl border border-border bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:top-11 sm:right-0 sm:w-96">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="font-semibold">Thông báo</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-sm font-medium text-primary hover:underline">
                Đánh dấu đã đọc
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chưa có thông báo</p>
          ) : (
            <ul>
              {items.map((n) => {
                const content = (
                  <>
                    <p className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
                    <p className="text-xs text-muted-foreground">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(new Date(n.createdAt))}</p>
                  </>
                );
                return (
                  <li key={n.id} className={cn('border-b border-border last:border-0', !n.readAt && 'bg-primary/5')}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => openItem(n)} className="block px-4 py-2.5 hover:bg-muted">
                        {content}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => openItem(n)} className="block w-full px-4 py-2.5 text-left hover:bg-muted">
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {toast && (
        <div role="status" className="fixed right-4 bottom-24 left-4 z-50 rounded-xl border border-border bg-surface p-3 shadow-xl sm:bottom-6 sm:left-auto sm:w-96">
          <p className="text-sm font-semibold">{toast.title}</p>
          <p className="text-xs text-muted-foreground">{toast.body}</p>
          {toast.link && (
            <Link href={toast.link} onClick={() => setToast(null)} className="mt-1 inline-block text-sm font-semibold text-primary hover:underline">
              Mở
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
