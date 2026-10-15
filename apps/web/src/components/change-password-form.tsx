'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Button } from './ui/button';
import { Field } from './ui/field';
import { Input } from './ui/input';

export function ChangePasswordForm({ forced, redirectTo }: { forced?: boolean; redirectTo?: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next = String(f.get('newPassword'));
    if (next !== String(f.get('confirm'))) {
      setErrors({ confirm: 'Mật khẩu nhập lại không khớp' });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api('/api/v1/me/password', { body: { currentPassword: String(f.get('currentPassword')), newPassword: next } });
      setDone(true);
      e.currentTarget?.reset();
      if (redirectTo) {
        router.replace(redirectTo);
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError && err.details?.fieldErrors) setErrors(Object.fromEntries(Object.entries(err.details.fieldErrors).map(([k, v]) => [k, v[0] ?? ''])));
      else setErrors({ form: err instanceof Error ? err.message : 'Không đổi được mật khẩu' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field id="pw-current" label={forced ? 'Mật khẩu tạm' : 'Mật khẩu hiện tại'} error={errors.currentPassword}>
        <Input id="pw-current" name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field id="pw-new" label="Mật khẩu mới" hint="Tối thiểu 8 ký tự" error={errors.newPassword}>
        <Input id="pw-new" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field id="pw-confirm" label="Nhập lại mật khẩu mới" error={errors.confirm}>
        <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {errors.form && <p role="alert" className="text-sm font-medium text-accent-text">{errors.form}</p>}
      {done && !redirectTo && <p role="status" className="text-sm font-medium text-primary dark:text-brand-green">Đã đổi mật khẩu.</p>}
      <Button type="submit" size="lg" disabled={busy}>{busy ? 'Đang lưu…' : 'Đổi mật khẩu'}</Button>
    </form>
  );
}
