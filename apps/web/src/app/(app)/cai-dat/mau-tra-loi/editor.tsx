'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

interface Item { id: string; shortcut: string; content: string }

export function QuickReplyEditor({ items }: { items: Item[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [content, setContent] = useState('');

  function open(item: Item | 'new') {
    setEditing(item);
    setShortcut(item === 'new' ? '' : item.shortcut);
    setContent(item === 'new' ? '' : item.content);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      if (editing === 'new') await api('/api/v1/quick-replies', { body: { shortcut, content } });
      else if (editing) await api(`/api/v1/quick-replies/${editing.id}`, { method: 'PATCH', body: { shortcut, content } });
      toast('Đã lưu mẫu');
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    }
  }

  async function remove(item: Item) {
    if (!window.confirm(`Xóa mẫu /${item.shortcut}?`)) return;
    try {
      await api(`/api/v1/quick-replies/${item.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không xóa được', 'error');
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => open('new')}><Plus className="size-4" />Thêm mẫu</Button></div>
      <ul className="divide-y divide-border">
        {items.map((q) => (
          <li key={q.id} className="flex items-start gap-3 py-2 text-sm">
            <span className="w-28 shrink-0 font-semibold">/{q.shortcut}</span>
            <span className="flex-1 whitespace-pre-line text-muted-foreground">{q.content}</span>
            <Button variant="ghost" size="sm" onClick={() => open(q)} aria-label={`Sửa /${q.shortcut}`}><Pencil className="size-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => remove(q)} aria-label={`Xóa /${q.shortcut}`}><Trash2 className="size-4" /></Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Thêm mẫu trả lời' : 'Sửa mẫu trả lời'}>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field id="qr-shortcut" label="Phím tắt" hint="Chữ không dấu, số, - _ (vd: chao, baogia)"><Input id="qr-shortcut" value={shortcut} onChange={(e) => setShortcut(e.target.value)} required /></Field>
          <Field id="qr-content" label="Nội dung"><Textarea id="qr-content" rows={5} value={content} onChange={(e) => setContent(e.target.value)} required /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Hủy</Button><Button type="submit">Lưu</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
