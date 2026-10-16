'use client';

import { toLocalVnPhone } from '@michio/shared';
import { Merge } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Button } from './ui/button';
import { useToast } from './ui/toast';

interface Suggestion { id: string; contactName: string; phone: string | null; shopName: string | null; province: string | null }

/** "Gộp" (SPEC 6.2): suggestions by same name + province, phone or email; merges the other record into this one. */
export function MergePanel({ customerId }: { customerId: string }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    api<{ items: Suggestion[] }>(`/api/v1/customers/${customerId}/merge-suggestions`).then((r) => setItems(r.items), () => setItems([]));
  }, [customerId]);

  if (!items?.length) return null;

  async function merge(sourceId: string) {
    setBusy(sourceId);
    try {
      await api('/api/v1/customers/merge', { body: { targetId: customerId, sourceId } });
      toast('Đã gộp hồ sơ');
      setItems((xs) => xs?.filter((x) => x.id !== sourceId) ?? null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không gộp được', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" data-testid="merge-suggestions">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Merge className="size-4" aria-hidden />
        Có thể là cùng một khách
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {s.contactName}
              {s.shopName && ` · ${s.shopName}`}
              {s.phone && ` · ${toLocalVnPhone(s.phone)}`}
              {s.province && ` · ${s.province}`}
            </span>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => merge(s.id)}>
              {busy === s.id ? 'Đang gộp…' : 'Gộp vào hồ sơ này'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
