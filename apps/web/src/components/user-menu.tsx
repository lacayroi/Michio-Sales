'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';

export interface UserMenuProps {
  fullName: string;
  roleLabel: string;
  status: 'AVAILABLE' | 'BUSY' | 'OFF' | 'INACTIVE';
}

export function UserMenu({ fullName, roleLabel, status: initialStatus }: UserMenuProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();
  const canToggle = status === 'AVAILABLE' || status === 'BUSY';

  async function toggleStatus() {
    const next = status === 'AVAILABLE' ? 'BUSY' : 'AVAILABLE';
    const res = await fetch('/api/v1/me/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) setStatus(next);
  }

  async function logout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    startTransition(() => router.replace('/login'));
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!canToggle}
        onClick={toggleStatus}
        title={canToggle ? 'Bấm để đổi trạng thái nhận lead' : undefined}
        className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:hover:bg-transparent"
      >
        <span
          className={cn('size-2 rounded-full', status === 'AVAILABLE' ? 'bg-brand-green' : 'bg-amber-500')}
          aria-hidden
        />
        <span className="hidden sm:inline">{status === 'AVAILABLE' ? 'Đang làm việc' : status === 'BUSY' ? 'Bận' : 'Nghỉ phép'}</span>
        <span className="sr-only sm:hidden">{status === 'AVAILABLE' ? 'Đang làm việc' : status === 'BUSY' ? 'Bận' : 'Nghỉ phép'}</span>
      </button>
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-sm font-semibold" data-testid="current-user">{fullName}</p>
        <p className="text-xs text-muted-foreground" data-testid="current-role">{roleLabel}</p>
      </div>
      <button
        type="button"
        onClick={logout}
        disabled={pending}
        className="rounded-lg p-2 hover:bg-muted"
        aria-label="Đăng xuất"
        title="Đăng xuất"
      >
        <LogOut className="size-5" />
      </button>
    </div>
  );
}
