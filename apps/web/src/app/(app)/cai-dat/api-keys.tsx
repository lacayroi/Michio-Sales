'use client';

import { formatDateTime, LEAD_SOURCE_LABELS } from '@michio/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/client';

interface Key {
  id: string;
  name: string;
  source: keyof typeof LEAD_SOURCE_LABELS;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function ApiKeys({ items }: { items: Key[] }) {
  const router = useRouter();
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError(null);
    const res = await api<{ key: string }>('/api/v1/api-keys', { body: { name: f.get('name'), source: f.get('source') } });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    setCreated(res.data!.key);
    form.reset();
    router.refresh();
  }

  async function revoke(k: Key) {
    if (!confirm(`Thu hồi key "${k.name}"? Website dùng key này sẽ không gửi lead được nữa.`)) return;
    const res = await api(`/api/v1/api-keys/${k.id}`, { method: 'DELETE' });
    if (!res.ok) return setError(res.error?.message ?? null);
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {created && (
        <div className="rounded-lg border border-primary p-3 text-sm" role="status">
          <p className="font-semibold">Key mới — chỉ hiển thị một lần, hãy dán vào cấu hình website ngay:</p>
          <p className="mt-1 font-mono break-all select-all" data-testid="new-api-key">
            {created}
          </p>
        </div>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {items.length === 0 && <li className="px-3 py-3 text-center text-muted-foreground">Chưa có API key</li>}
        {items.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>
              <span className="font-medium">{k.name}</span>
              <span className="text-muted-foreground"> · {LEAD_SOURCE_LABELS[k.source]}</span>
              <span className="block text-xs text-muted-foreground">
                {k.revokedAt ? `Đã thu hồi ${formatDateTime(new Date(k.revokedAt))}` : k.lastUsedAt ? `Dùng gần nhất ${formatDateTime(new Date(k.lastUsedAt))}` : 'Chưa dùng'}
              </span>
            </span>
            {!k.revokedAt && (
              <Button size="sm" variant="ghost" onClick={() => revoke(k)}>
                Thu hồi
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <Input name="name" required placeholder="Tên key, vd: Website form sỉ" className="h-9 min-w-48 flex-1" aria-label="Tên key" />
        <Select name="source" defaultValue="WEBSITE_WHOLESALE_FORM" className="h-9 w-auto" aria-label="Nguồn mặc định">
          <option value="WEBSITE_WHOLESALE_FORM">Form sỉ</option>
          <option value="WEBSITE_AGENT_FORM">Form đại lý</option>
          <option value="OTHER">Khác</option>
        </Select>
        <Button type="submit" size="sm" disabled={busy}>
          Tạo key
        </Button>
      </form>
      <FormError message={error} />
    </div>
  );
}
