'use client';

import { formatDateTime, LEAD_SOURCE_LABELS } from '@michio/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

export function ApiKeys({ keys }: { keys: { id: string; name: string; source: keyof typeof LEAD_SOURCE_LABELS; lastUsedAt: string | null; revoked: boolean }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [created, setCreated] = useState<string | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ key: string }>('/api/v1/api-keys', { body: { name: String(f.get('name')), source: String(f.get('source')) } });
      setCreated(r.key);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tạo được', 'error');
    }
  }
  async function revoke(id: string) {
    try {
      await api(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
      toast('Đã thu hồi key');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lỗi', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {keys.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có key nào.</li>}
        {keys.map((k) => (
          <li key={k.id} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${k.revoked ? 'opacity-50' : ''}`}>
            <span>
              <strong>{k.name}</strong> · {LEAD_SOURCE_LABELS[k.source]}
              <span className="block text-xs text-muted-foreground">{k.revoked ? 'Đã thu hồi' : k.lastUsedAt ? `Dùng lần cuối ${formatDateTime(new Date(k.lastUsedAt))}` : 'Chưa dùng'}</span>
            </span>
            {!k.revoked && <Button size="sm" variant="ghost" onClick={() => revoke(k.id)}>Thu hồi</Button>}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3">
        <Input name="name" required placeholder="Tên (vd: Website michiovietnam.com)" className="min-w-48 flex-1" aria-label="Tên key" />
        <Select name="source" className="w-auto" aria-label="Nguồn mặc định">
          <option value="WEBSITE_WHOLESALE_FORM">Form sỉ</option>
          <option value="WEBSITE_AGENT_FORM">Form đại lý</option>
        </Select>
        <Button type="submit">Tạo key</Button>
      </form>
      <Dialog open={created !== null} onClose={() => setCreated(null)} title="API key mới">
        <p className="mb-2 text-sm">Sao chép key vào <code>wp-config.php</code> (MICHIO_HUB_API_KEY). Key chỉ hiện một lần.</p>
        <p className="break-all rounded-lg bg-muted p-3 font-mono text-sm" data-testid="new-api-key">{created}</p>
      </Dialog>
    </div>
  );
}
