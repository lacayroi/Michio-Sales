'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

export function FacebookActions({ connect, connectLabel, disconnectId, disabled }: { connect?: boolean; connectLabel?: string; disconnectId?: string; disabled?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  if (connect) {
    // Full navigation: the server redirects to Facebook's login dialog (or connects the demo Page).
    return disabled ? (
      <Button disabled>{connectLabel}</Button>
    ) : (
      <a href="/api/v1/integrations/facebook/connect" className={buttonVariants()}>{connectLabel}</a>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        if (!window.confirm('Ngắt kết nối Page này? Tin nhắn mới sẽ không vào hệ thống nữa.')) return;
        try {
          await api('/api/v1/integrations/facebook/disconnect', { body: { channelAccountId: disconnectId } });
          toast('Đã ngắt kết nối');
          router.refresh();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Thất bại', 'error');
        }
      }}
    >
      Ngắt kết nối
    </Button>
  );
}

export function PagePicker({ state, pages }: { state: string; pages: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="rounded-xl border-2 border-brand-green bg-surface p-4">
      <h2 className="mb-2 font-semibold">Chọn Page để kết nối</h2>
      <ul className="flex flex-col gap-2">
        {pages.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span>{p.name} <span className="text-xs text-muted-foreground">({p.id})</span></span>
            <Button size="sm" disabled={!!busy} onClick={async () => {
              setBusy(p.id);
              try {
                await api('/api/v1/integrations/facebook/connect', { body: { state, pageId: p.id } });
                toast(`Đã kết nối ${p.name}`);
                router.replace('/cai-dat/facebook?connected=1');
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Thất bại', 'error');
              } finally {
                setBusy(null);
              }
            }}>Kết nối</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Messenger window policy (SPEC 5.2 / 7.1, values per Meta docs — D-028). */
export function WindowSettings({ standardHours, humanDays, useHumanAgentTag }: { standardHours: number; humanDays: number; useHumanAgentTag: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(useHumanAgentTag);
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      <h2 className="mb-2 font-semibold">Khung thời gian nhắn tin</h2>
      <p className="mb-3 text-muted-foreground">
        Messenger chỉ cho Page nhắn trong <strong>{standardHours} giờ</strong> sau tin cuối của khách. Hết khung, ô soạn tin bị khóa và gợi ý gọi điện / nhắn Zalo.
      </p>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={on} onChange={async (e) => {
          const v = e.target.checked;
          setOn(v);
          try {
            await api('/api/v1/settings/facebook.useHumanAgentTag', { method: 'PUT', body: { value: v } });
            toast('Đã lưu');
            router.refresh();
          } catch (err) {
            setOn(!v);
            toast(err instanceof Error ? err.message : 'Thất bại', 'error');
          }
        }} />
        <span>
          Dùng thẻ <strong>“Nhân viên hỗ trợ” (HUMAN_AGENT)</strong> để trả lời thủ công tới {humanDays} ngày sau tin cuối của khách.
          <span className="block text-xs text-muted-foreground">Chỉ bật khi app đã được Meta duyệt quyền này; dùng sai mục đích có thể bị hạn chế gửi tin.</span>
        </span>
      </label>
    </div>
  );
}
