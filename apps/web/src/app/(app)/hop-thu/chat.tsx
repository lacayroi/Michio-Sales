'use client';

import { formatDateTime, renderQuickReply } from '@michio/shared';
import { AlertTriangle, ArrowLeft, AtSign, CalendarPlus, Info, Loader2, Package, Paperclip, Phone, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

export interface ChatMessage {
  id: string;
  direction: 'IN' | 'OUT' | 'NOTE';
  kind: string;
  text: string | null;
  attachments: ({ url?: string | null; type?: string; fileName?: string; mentions?: string[] } & Record<string, unknown>) | { url: string | null; type: string }[] | null;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'RECEIVED';
  error: string | null;
  createdAt: string;
  sentBy: string | null;
}

type Window = { ok: true; mode: 'standard' | 'human_agent'; closesAt: string } | { ok: false; reason: string };

interface Props {
  conversationId: string;
  title: string;
  subtitle: string;
  backHref: string;
  messages: ChatMessage[];
  hasMore: boolean;
  canReply: boolean;
  window: Window;
  phone: string | null;
  leadId: string | null;
  quickReplies: { shortcut: string; content: string }[];
  vars: { customerName: string; salesName: string; salesPhone: string | null };
  colleagues: { id: string; fullName: string }[];
  card: ReactNode;
}

const STATUS_LABEL: Record<ChatMessage['status'], string> = { QUEUED: 'Đang gửi…', SENT: 'Đã gửi', DELIVERED: 'Đã nhận', FAILED: 'Gửi lỗi', RECEIVED: '' };
const localPhone = (p: string | null) => (p?.startsWith('+84') ? `0${p.slice(3)}` : p);

function attachmentsOf(m: ChatMessage): { url: string | null; type: string; name?: string }[] {
  if (Array.isArray(m.attachments)) return m.attachments.map((a) => ({ url: a.url, type: a.type }));
  if (m.attachments?.url) return [{ url: m.attachments.url, type: m.kind === 'image' ? 'image' : 'file', name: m.attachments.fileName }];
  return [];
}

function Bubble({ m }: { m: ChatMessage }) {
  const atts = attachmentsOf(m);
  if (m.direction === 'NOTE') {
    return (
      <li className="mx-auto w-full max-w-xl rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-50" data-testid="note">
        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-80">Ghi chú nội bộ · {m.sentBy} · {formatDateTime(new Date(m.createdAt))}</p>
        <p className="whitespace-pre-line">{m.text}</p>
      </li>
    );
  }
  const out = m.direction === 'OUT';
  return (
    <li className={cn('flex flex-col', out ? 'items-end' : 'items-start')} data-testid={out ? 'msg-out' : 'msg-in'}>
      <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm sm:max-w-[70%]', out ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted', m.status === 'FAILED' && 'ring-2 ring-accent')}>
        {atts.map((a, i) =>
          a.type === 'image' || a.type === 'sticker' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={i} href={a.url ?? '#'} target="_blank" rel="noreferrer"><img src={a.url ?? ''} alt={a.type === 'sticker' ? 'Sticker' : 'Ảnh'} className={cn('mb-1 rounded-lg', a.type === 'sticker' ? 'size-24' : 'max-h-64')} /></a>
          ) : (
            <a key={i} href={a.url ?? '#'} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1 underline"><Paperclip className="size-3.5" />{a.name ?? 'Tệp đính kèm'}</a>
          ),
        )}
        {m.text && <p className="whitespace-pre-line break-words">{m.text}</p>}
      </div>
      <p className="mt-0.5 px-1 text-[11px] text-muted-foreground">
        {formatDateTime(new Date(m.createdAt)).slice(11)}
        {out && m.sentBy && ` · ${m.sentBy}`}
        {out && ` · ${STATUS_LABEL[m.status]}`}
        {m.status === 'FAILED' && m.error && <span className="text-accent-text"> — {m.error}</span>}
      </p>
    </li>
  );
}

export function Chat(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(p.hasMore);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [showCard, setShowCard] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => [...older, ...p.messages], [older, p.messages]);
  const locked = mode === 'reply' && !p.window.ok;

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, which must not
  // become the effect's cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [p.messages.length]);

  const slash = mode === 'reply' && text.startsWith('/') ? text.slice(1).toLowerCase() : null;
  const suggestions = slash === null ? [] : p.quickReplies.filter((q) => q.shortcut.toLowerCase().startsWith(slash) || q.content.toLowerCase().includes(slash)).slice(0, 8);

  async function loadOlder() {
    const first = all[0];
    if (!first) return;
    const r = await api<{ messages: (Omit<ChatMessage, 'sentBy'> & { sentBy: { fullName: string } | null })[]; hasMore: boolean }>(`/api/v1/conversations/${p.conversationId}/messages?before=${encodeURIComponent(first.createdAt)}`);
    setOlder((xs) => [...r.messages.map((m) => ({ ...m, sentBy: m.sentBy?.fullName ?? null })), ...xs]);
    setHasMore(r.hasMore);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thao tác thất bại', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    const ok =
      mode === 'reply'
        ? await run(() => api(`/api/v1/conversations/${p.conversationId}/messages`, { body: { kind: 'text', text: body, idempotencyKey: crypto.randomUUID() } }))
        : await run(() => api(`/api/v1/conversations/${p.conversationId}/notes`, { body: { text: body, mentionUserIds: mentions } }));
    if (ok) {
      setText('');
      setMentions([]);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (suggestions[0] && slash !== null) pickReply(suggestions[0].content);
      else void send();
    }
  }

  function pickReply(content: string) {
    setText(renderQuickReply(content, p.vars));
  }

  async function sendFile(file: File) {
    const form = new FormData();
    form.set('file', file);
    form.set('idempotencyKey', crypto.randomUUID());
    if (await run(() => api(`/api/v1/conversations/${p.conversationId}/messages`, { form }))) toast('Đã gửi tệp');
  }

  return (
    <div className="flex min-h-0 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Link href={p.backHref} className="rounded-lg p-1.5 hover:bg-muted lg:hidden" aria-label="Quay lại danh sách"><ArrowLeft className="size-5" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold" data-testid="chat-title">{p.title}</h2>
          <p className="truncate text-xs text-muted-foreground">{p.subtitle}</p>
        </div>
        {p.phone && <a href={`tel:${localPhone(p.phone)}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} aria-label="Gọi khách"><Phone className="size-4" /></a>}
        <Button variant="outline" size="sm" className="xl:hidden" onClick={() => setShowCard(true)} aria-label="Thông tin khách"><Info className="size-4" /></Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {hasMore && (
          <div className="mb-3 text-center"><Button variant="ghost" size="sm" onClick={loadOlder}>Tải tin cũ hơn</Button></div>
        )}
        <ul className="flex flex-col gap-3" data-testid="messages">
          {all.map((m) => <Bubble key={m.id} m={m} />)}
        </ul>
        <div ref={endRef} />
      </div>

      {p.canReply && (
        <div className="border-t border-border bg-surface p-3">
          <div className="mb-2 flex items-center gap-1 text-xs">
            {(['reply', 'note'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k}
                className={cn('rounded-full px-3 py-1 font-medium', mode === k ? (k === 'note' ? 'bg-amber-200 text-amber-950' : 'bg-primary text-primary-foreground') : 'bg-muted')}>
                {k === 'reply' ? 'Trả lời khách' : 'Ghi chú nội bộ'}
              </button>
            ))}
            {mode === 'reply' && p.window.ok && (
              <span className="ml-auto text-muted-foreground" data-testid="window-status">
                {p.window.mode === 'human_agent' ? 'Ngoài 24 giờ — gửi với thẻ "Nhân viên hỗ trợ", đến ' : 'Nhắn được đến '}
                {formatDateTime(new Date(p.window.closesAt))}
              </span>
            )}
          </div>

          {locked ? (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm" role="status" data-testid="window-locked">
              <p className="mb-2 flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-text" />{(p.window as { reason: string }).reason}</p>
              <div className="flex flex-wrap gap-2">
                {p.phone && <a href={`tel:${localPhone(p.phone)}`} className={buttonVariants({ size: 'sm' })}><Phone className="size-4" />Gọi điện</a>}
                {p.phone && <a href={`https://zalo.me/${localPhone(p.phone)}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Nhắn Zalo</a>}
                <Button variant="outline" size="sm" onClick={() => setTaskOpen(true)}><CalendarPlus className="size-4" />Tạo việc gọi lại</Button>
              </div>
            </div>
          ) : (
            <div className="relative">
              {suggestions.length > 0 && (
                <ul className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg" role="listbox" aria-label="Mẫu trả lời nhanh">
                  {suggestions.map((q) => (
                    <li key={q.shortcut}>
                      <button type="button" role="option" aria-selected={false} onClick={() => pickReply(q.content)} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">
                        <span className="font-semibold">/{q.shortcut}</span> <span className="text-muted-foreground">{renderQuickReply(q.content, p.vars).slice(0, 90)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                rows={2}
                className={cn('min-h-12 resize-none', mode === 'note' && 'bg-amber-50 dark:bg-amber-950/30')}
                placeholder={mode === 'reply' ? 'Nhập tin nhắn… (gõ / để chọn mẫu trả lời)' : 'Ghi chú cho đồng nghiệp (khách không thấy)… gõ @ để nhắc'}
                aria-label={mode === 'reply' ? 'Tin nhắn trả lời' : 'Ghi chú nội bộ'}
              />
              <div className="mt-2 flex items-center gap-1">
                {mode === 'reply' ? (
                  <>
                    <input ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void sendFile(f); }} />
                    <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Gửi ảnh / tệp"><Paperclip className="size-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setProductOpen(true)} disabled={busy} aria-label="Gửi sản phẩm"><Package className="size-4" /><span className="hidden sm:inline">Sản phẩm</span></Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setMentionOpen(true)} aria-label="Nhắc đồng nghiệp"><AtSign className="size-4" /><span className="hidden sm:inline">Nhắc</span></Button>
                )}
                <Button size="sm" className="ml-auto" onClick={send} disabled={busy || !text.trim()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {mode === 'reply' ? 'Gửi' : 'Lưu ghi chú'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={showCard} onClose={() => setShowCard(false)} title="Thông tin khách">{p.card}</Dialog>
      <ProductPicker open={productOpen} onClose={() => setProductOpen(false)} onPick={async (id) => {
        if (await run(() => api(`/api/v1/conversations/${p.conversationId}/messages`, { body: { kind: 'product', productId: id, idempotencyKey: crypto.randomUUID() } }))) {
          setProductOpen(false);
          toast('Đã gửi sản phẩm');
        }
      }} />
      <Dialog open={mentionOpen} onClose={() => setMentionOpen(false)} title="Nhắc đồng nghiệp">
        <ul className="divide-y divide-border">
          {p.colleagues.map((u) => (
            <li key={u.id}>
              <button type="button" className="w-full px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => {
                setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${u.fullName} `);
                setMentions((m) => [...new Set([...m, u.id])]);
                setMentionOpen(false);
              }}>@{u.fullName}</button>
            </li>
          ))}
        </ul>
      </Dialog>
      <CallbackTask open={taskOpen} onClose={() => setTaskOpen(false)} leadId={p.leadId} name={p.vars.customerName} />
    </div>
  );
}

interface ProductHit { id: string; sku: string; name: string; imageUrl: string | null; inStock: boolean; unit: string | null }

function ProductPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductHit[]>([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const r = await api<{ items: ProductHit[] }>(`/api/v1/products?forQuote=true&limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`).catch(() => ({ items: [] }));
      setItems(r.items);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <Dialog open={open} onClose={onClose} title="Gửi sản phẩm" wide>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc mã (không cần dấu)" aria-label="Tìm sản phẩm" autoFocus />
      <ul className="mt-3 max-h-96 divide-y divide-border overflow-y-auto">
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p.id)} className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-muted">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="size-10 rounded object-cover" />
              ) : <span className="flex size-10 items-center justify-center rounded bg-muted"><Package className="size-4 text-muted-foreground" /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.sku}{!p.inStock && ' · hết hàng'}</span>
              </span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Không có sản phẩm phù hợp</li>}
      </ul>
    </Dialog>
  );
}

/** Outside the Messenger window the sales calls instead; one click leaves a task (SPEC 5.2). */
function CallbackTask({ open, onClose, leadId, name }: { open: boolean; onClose: () => void; leadId: string | null; name: string }) {
  const toast = useToast();
  const router = useRouter();
  const [due, setDue] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  async function save() {
    try {
      await api('/api/v1/tasks', { body: { title: `Gọi lại ${name} (hết khung nhắn Messenger)`, type: 'CALL', dueAt: new Date(due).toISOString(), leadId: leadId ?? undefined } });
      toast('Đã tạo việc gọi lại');
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tạo được việc', 'error');
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Tạo việc gọi lại">
      <label className="mb-1 block text-sm font-medium" htmlFor="cb-due">Thời điểm</label>
      <Input id="cb-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Hủy</Button>
        <Button onClick={save}>Tạo việc</Button>
      </div>
    </Dialog>
  );
}
