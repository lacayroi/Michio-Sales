'use client';

import { TASK_TYPE_LABELS } from '@michio/shared';
import { Check, Clock, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

const localInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function useRun() {
  const router = useRouter();
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      router.refresh();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thao tác thất bại', 'error');
      return false;
    }
  };
}

export function TaskRowActions({ taskId, code, dueAt }: { taskId: string; code: number; dueAt: string }) {
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(localInput(dueAt));
  return (
    <div className="flex gap-1">
      <Button size="sm" onClick={() => run(() => api(`/api/v1/tasks/${taskId}/complete`, { body: {} }), `Đã xong việc V${code}`)} aria-label={`Xong việc V${code}`}><Check className="size-4" />Xong</Button>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Dời việc V${code}`}><Clock className="size-4" /></Button>
      <Button size="sm" variant="ghost" onClick={() => window.confirm('Hủy việc này?') && run(() => api(`/api/v1/tasks/${taskId}`, { method: 'PATCH', body: { status: 'CANCELLED' } }), 'Đã hủy việc')} aria-label={`Hủy việc V${code}`}><X className="size-4" /></Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Dời việc V${code}`}>
        <Field id={`due-${taskId}`} label="Thời hạn mới"><Input id={`due-${taskId}`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Hủy</Button>
          <Button onClick={async () => (await run(() => api(`/api/v1/tasks/${taskId}`, { method: 'PATCH', body: { dueAt: new Date(due).toISOString() } }), 'Đã dời việc')) && setOpen(false)}>Lưu</Button>
        </div>
      </Dialog>
    </div>
  );
}

export function NewTaskButton() {
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('CALL');
  const [due, setDue] = useState(() => localInput(new Date(Date.now() + 3600_000).toISOString()));
  const [note, setNote] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api('/api/v1/tasks', { body: { title, type, dueAt: new Date(due).toISOString(), note: note || undefined } }), 'Đã tạo việc')) {
      setOpen(false);
      setTitle('');
      setNote('');
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="size-4" />Thêm việc</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Thêm việc">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field id="nt-title" label="Việc cần làm"><Input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field id="nt-type" label="Loại"><Select id="nt-type" value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TASK_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field id="nt-due" label="Thời hạn"><Input id="nt-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required /></Field>
          </div>
          <Field id="nt-note" label="Ghi chú"><Textarea id="nt-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Hủy</Button><Button type="submit">Tạo</Button></div>
        </form>
      </Dialog>
    </>
  );
}
