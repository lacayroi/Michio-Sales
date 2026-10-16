'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client';

/** "Kết nối Zalo Bot" (SPEC 5.5): mã 6 số, hạn 10 phút, nhắn mã cho bot. */
export function ZaloBotCard({ linked, mock }: { linked: boolean; mock: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [code]);

  // While a code is shown, poll for the link to complete (the bot sets it when the code arrives).
  useEffect(() => {
    if (!code || linked) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [code, linked, router]);

  useEffect(() => {
    if (linked) setCode(null);
  }, [linked]);

  async function getCode() {
    setBusy(true);
    try {
      setCode(await api<{ code: string; expiresAt: string }>('/api/v1/me/zalo-bot/link-code', { body: {} }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Không lấy được mã', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!confirm('Ngắt kết nối Zalo Bot? Bạn sẽ không nhận thông báo lead qua Zalo nữa.')) return;
    setBusy(true);
    try {
      await api('/api/v1/me/zalo-bot', { method: 'DELETE' });
      toast('Đã ngắt kết nối Zalo Bot');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (linked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="zalo-bot-status">
        <p className="text-sm">
          <span className="font-semibold text-primary dark:text-brand-green">✓ Đã kết nối.</span> Thông báo lead, nhắc việc và tổng kết sáng sẽ gửi qua Zalo. Nhắn <b>HELP</b> cho bot để xem lệnh.
        </p>
        <Button variant="ghost" size="sm" onClick={unlink} disabled={busy}>
          Ngắt kết nối
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="zalo-bot-status">
      <p className="text-sm text-muted-foreground">
        Nhận lead mới, nhắc việc và thao tác nhanh (NHAN, TRA, HEN…) ngay trên Zalo. {mock ? 'Đang chạy chế độ mô phỏng: gửi mã vào khung chat bên dưới.' : 'Mở Zalo, tìm bot "Michio Sales" và gửi mã kết nối.'}
      </p>
      {code && left > 0 ? (
        <div className="rounded-lg bg-muted px-4 py-3">
          <p className="text-xs text-muted-foreground">Gửi mã này cho bot (còn {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')})</p>
          <p className="font-mono text-3xl font-bold tracking-[0.3em] select-all" data-testid="link-code">
            {code.code}
          </p>
        </div>
      ) : (
        <Button onClick={getCode} disabled={busy} className="self-start">
          {code ? 'Mã đã hết hạn — lấy mã mới' : 'Lấy mã kết nối'}
        </Button>
      )}
    </div>
  );
}
