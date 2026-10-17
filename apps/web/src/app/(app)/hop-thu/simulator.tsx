'use client';

import { FlaskConical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

/** Demo mode only: play a customer writing to the Page and see what the shop sent back. */
export function MessengerSimulator() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [psid, setPsid] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [received, setReceived] = useState<{ text?: string; kind: string; at: string }[]>([]);

  useEffect(() => {
    if (open && !psid) setPsid(`demo-${Math.random().toString(36).slice(2, 8)}`);
  }, [open, psid]);

  useEffect(() => {
    if (!open || !psid) return;
    const load = () => api<{ messages: typeof received }>(`/api/v1/dev/facebook?psid=${psid}`).then((r) => setReceived(r.messages)).catch(() => {});
    void load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [open, psid]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/api/v1/dev/facebook', { body: { psid, name: name || undefined, text } });
      setText('');
      toast('Khách đã nhắn vào Page');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không gửi được', 'error');
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><FlaskConical className="size-4" />Mô phỏng khách</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Mô phỏng khách nhắn Messenger">
        <form onSubmit={submit} className="flex flex-col gap-3" data-testid="fb-simulator">
          <p className="text-xs text-muted-foreground">Chế độ demo: tin đi qua đúng luồng webhook Facebook → tạo/ghép lead → chia → hộp thư.</p>
          <div className="grid grid-cols-2 gap-2">
            <Field id="sim-psid" label="Mã khách (PSID)"><Input id="sim-psid" value={psid} onChange={(e) => setPsid(e.target.value)} required /></Field>
            <Field id="sim-name" label="Tên hiển thị"><Input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chị Hoa" /></Field>
          </div>
          <Field id="sim-text" label="Khách nhắn"><Textarea id="sim-text" value={text} onChange={(e) => setText(e.target.value)} required rows={2} /></Field>
          <Button type="submit">Gửi vào Page</Button>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Khách đã nhận từ shop</p>
            <ul className="max-h-40 overflow-y-auto rounded-lg bg-muted p-2 text-sm" data-testid="fb-simulator-received">
              {received.length === 0 && <li className="text-muted-foreground">—</li>}
              {received.map((m, i) => <li key={i} className="whitespace-pre-line border-b border-border/60 py-1 last:border-0">{m.text ?? `[${m.kind}]`}</li>)}
            </ul>
          </div>
        </form>
      </Dialog>
    </>
  );
}
