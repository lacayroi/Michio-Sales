'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client';

interface Item {
  type: string;
  label: string;
  locked?: boolean;
  enabled: boolean;
}

/** SPEC 6.12: tự bật/tắt từng loại thông báo Zalo, trừ "được giao lead". */
export function NotificationPrefs({ items, disabled }: { items: Item[]; disabled: boolean }) {
  const toast = useToast();
  const [state, setState] = useState(() => Object.fromEntries(items.map((i) => [i.type, i.enabled])));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api('/api/v1/me/notification-prefs', { method: 'PUT', body: { zalo: state } });
      toast('Đã lưu cài đặt thông báo');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {disabled && <p className="text-sm text-muted-foreground">Kết nối Zalo Bot để nhận các thông báo này qua Zalo. Trên web, mọi thông báo vẫn hiện ở chuông.</p>}
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i.type}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={i.locked ? true : (state[i.type] ?? true)}
                disabled={i.locked || disabled}
                onChange={(e) => setState((s) => ({ ...s, [i.type]: e.target.checked }))}
              />
              {i.label}
              {i.locked && <span className="text-xs text-muted-foreground">(luôn bật)</span>}
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Ngoài giờ làm việc, Zalo chỉ nhận cảnh báo khẩn; các thông báo khác được gửi lúc mở cửa.</p>
      <Button size="sm" variant="outline" onClick={save} disabled={busy || disabled} className="self-start">
        Lưu
      </Button>
    </div>
  );
}
