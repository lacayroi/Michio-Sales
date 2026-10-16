'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Option {
  value: string;
  label: string;
}

export function LeadFilters({
  initial,
  tab,
  sources,
  owners,
}: {
  initial: { q: string; source: string; priority: string; ownerId: string };
  tab: string;
  sources: Option[];
  owners: Option[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const qs = new URLSearchParams({ tab });
    for (const k of ['q', 'source', 'priority', 'ownerId']) {
      const v = String(f.get(k) ?? '').trim();
      if (v) qs.set(k, v);
    }
    start(() => router.replace(`${pathname}?${qs}`));
  }

  return (
    <form onSubmit={apply} className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" role="search">
      <div className="relative col-span-2 sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={initial.q} placeholder="Tên, shop, SĐT, mã lead…" aria-label="Tìm lead" className="pl-9 sm:h-10 sm:text-sm" />
      </div>
      <Select name="source" defaultValue={initial.source} aria-label="Nguồn" className="sm:w-44">
        <option value="">Mọi nguồn</option>
        {sources.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Select name="priority" defaultValue={initial.priority} aria-label="Mức ưu tiên" className="sm:w-36">
        <option value="">Mọi mức</option>
        <option value="HOT">🔥 HOT</option>
        <option value="WARM">Ấm</option>
        <option value="COLD">Thường</option>
      </Select>
      {owners && (
        <Select name="ownerId" defaultValue={initial.ownerId} aria-label="Người phụ trách" className="col-span-2 sm:w-48">
          <option value="">Mọi người phụ trách</option>
          <option value="none">— Chưa có người</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
      <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1" disabled={pending}>
        Lọc
      </Button>
    </form>
  );
}
