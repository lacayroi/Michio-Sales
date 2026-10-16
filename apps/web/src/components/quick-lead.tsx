'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError } from '@/lib/client';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';
import { useToast } from './ui/toast';

const Schema = z.object({
  phone: z.string().trim().min(6, 'Nhập số điện thoại'),
  name: z.string().trim().min(1, 'Nhập tên khách'),
  note: z.string().max(2000).optional(),
  source: z.enum(['ZALO_COMPANY', 'HOTLINE', 'REFERRAL', 'MANUAL', 'OTHER']),
  assignMode: z.enum(['AUTO', 'SELF']),
});
type Values = z.infer<typeof Schema>;

interface Result { code: number; duplicate: boolean; assignedTo: string | null; leadId: string; assignment: { status: string } | null }

/** "+ Lead nhanh" (SPEC 5.3 A, S4): phone + name + note in < 15 s; always visible, mobile included. */
export function QuickLeadButton({ isSales }: { isSales: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const form = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: { phone: '', name: '', note: '', source: 'ZALO_COMPANY', assignMode: 'AUTO' },
  });
  const source = form.watch('source');

  async function onSubmit(v: Values) {
    try {
      const r = await api<Result>('/api/v1/leads/quick', { body: { ...v, assignMode: isSales ? v.assignMode : 'AUTO' } });
      const who = r.assignedTo ? ` → ${r.assignedTo}` : r.assignment?.status === 'QUEUED' ? ' → chờ giao tay' : '';
      toast(r.duplicate ? `Khách đã có lead #${r.code}${who}. Đã ghi nhận liên hệ lại.` : `Đã tạo lead #${r.code}${who}`, r.duplicate ? 'info' : 'success');
      form.reset({ phone: '', name: '', note: '', source: v.source, assignMode: v.assignMode });
      setOpen(false);
      router.push(`/leads/${r.leadId}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.details?.fieldErrors?.phone) form.setError('phone', { message: err.message });
      else toast(err instanceof Error ? err.message : 'Không tạo được lead', 'error');
    }
  }

  const e = form.formState.errors;
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="h-9 whitespace-nowrap px-2.5 sm:px-3" data-testid="quick-lead" aria-label="Lead nhanh">
        <Plus className="size-4" aria-hidden />
        <span className="sm:hidden">Lead</span>
        <span className="hidden sm:inline">Lead nhanh</span>
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="+ Lead nhanh">
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
          <Field id="ql-phone" label="Số điện thoại *" error={e.phone?.message}>
            <Input id="ql-phone" inputMode="tel" autoComplete="off" autoFocus {...form.register('phone')} />
          </Field>
          <Field id="ql-name" label="Tên khách / shop *" error={e.name?.message}>
            <Input id="ql-name" autoComplete="off" {...form.register('name')} />
          </Field>
          <Field id="ql-note" label="Ghi chú">
            <Textarea id="ql-note" rows={2} placeholder="vd: shop mẹ bé Hải Phòng, quan tâm matcha, bánh kẹo" {...form.register('note')} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="ql-source" label="Nguồn">
              <Select id="ql-source" {...form.register('source')}>
                <option value="ZALO_COMPANY">Zalo công ty</option>
                <option value="HOTLINE">Hotline</option>
                <option value="REFERRAL">Giới thiệu</option>
                <option value="MANUAL">Nhập tay</option>
                <option value="OTHER">Khác</option>
              </Select>
            </Field>
            {isSales && (
              <Field id="ql-assign" label="Giao cho" hint={source === 'ZALO_COMPANY' ? 'Lead Zalo công ty thường chia xoay vòng' : undefined}>
                <Select id="ql-assign" {...form.register('assignMode')}>
                  <option value="AUTO">Chia xoay vòng</option>
                  <option value="SELF">Tôi tự nhận</option>
                </Select>
              </Field>
            )}
          </div>
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Đang tạo…' : 'Tạo lead'}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
