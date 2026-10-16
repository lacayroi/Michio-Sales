'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client';

export function RegisterWebhook({ url }: { url: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function register() {
    setBusy(true);
    try {
      const r = await api<{ result: { verification?: { outcome?: string; hint?: string } } }>('/api/v1/integrations/zalo-bot', { body: {} });
      const v = r.result.verification;
      toast(v?.outcome === 'webhook.ok' ? 'Đã đăng ký webhook, Zalo kiểm tra thành công' : `Đã đăng ký webhook. Zalo báo: ${v?.hint ?? v?.outcome ?? 'chưa kiểm tra'}`, v?.outcome === 'webhook.ok' ? 'success' : 'info');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Không đăng ký được', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={register} disabled={busy || !url}>
        Đăng ký webhook
      </Button>
      <span className="text-xs break-all text-muted-foreground">{url ?? 'Cần APP_URL (HTTPS công khai)'}</span>
    </div>
  );
}
