'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/client';

export function ChangePasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('newPassword') !== f.get('confirm')) {
      setError('Mật khẩu nhập lại không khớp');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api('/api/v1/me/password', { body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') } });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Mật khẩu hiện tại (mật khẩu tạm)" htmlFor="currentPassword">
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required autoFocus />
      </Field>
      <Field label="Mật khẩu mới" htmlFor="newPassword" hint="Ít nhất 8 ký tự">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Nhập lại mật khẩu mới" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'Đang lưu…' : 'Lưu mật khẩu mới'}
      </Button>
    </form>
  );
}
