'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

export function WooSyncButtons({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  async function sync(full: boolean) {
    try {
      await api('/api/v1/integrations/woocommerce/sync', { body: { full } });
      toast('Đã bắt đầu đồng bộ — tải lại trang sau ít phút');
      setTimeout(() => router.refresh(), 4000);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không đồng bộ được', 'error');
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled} onClick={() => sync(false)}><RefreshCw className="size-4" />Đồng bộ ngay</Button>
      <Button variant="outline" disabled={disabled} onClick={() => sync(true)}>Đồng bộ lại toàn bộ</Button>
    </div>
  );
}

export function WooForm({ baseUrl, source }: { baseUrl: string; source: 'settings' | 'env' | null }) {
  const router = useRouter();
  const toast = useToast();
  const [url, setUrl] = useState(baseUrl);
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/api/v1/integrations/woocommerce', { body: { baseUrl: url, consumerKey: key, consumerSecret: secret } });
      toast('Đã lưu khóa (mã hóa)');
      setKey('');
      setSecret('');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    }
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Khóa REST API (quyền Read)</h2>
      <p className="text-sm text-muted-foreground">
        WooCommerce → Cài đặt → Nâng cao → REST API → Thêm khóa, quyền <strong>Read</strong>.
        {source === 'env' && ' Hiện đang dùng khóa trong biến môi trường WOO_*.'}
        {source === 'settings' && ' Đã có khóa lưu trong hệ thống; nhập lại để thay.'}
      </p>
      <Field id="w-url" label="Website"><Input id="w-url" value={url} onChange={(e) => setUrl(e.target.value)} required /></Field>
      <Field id="w-key" label="Consumer Key"><Input id="w-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ck_…" required autoComplete="off" /></Field>
      <Field id="w-secret" label="Consumer Secret"><Input id="w-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="cs_…" required autoComplete="off" /></Field>
      <div className="flex justify-end"><Button type="submit">Lưu khóa</Button></div>
    </form>
  );
}
