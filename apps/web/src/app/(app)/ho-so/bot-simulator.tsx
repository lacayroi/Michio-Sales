'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/client';
import { cn } from '@/lib/utils';

interface Message {
  text: string;
  at: string;
  from?: 'bot' | 'user';
}

/**
 * Demo of the Zalo chat with the bot (MOCK_INTEGRATIONS=true): what you type goes through the real
 * webhook pipeline; bot notifications (lead mới, nhắc việc…) appear here as they would on Zalo.
 */
export function BotSimulator() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await api<{ messages: Message[] }>('/api/v1/dev/zalo-bot').catch(() => null);
    if (r) setMessages(r.messages);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);
  // Block body: newer browsers return a Promise from scrollIntoView, which React would take as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ messages: Message[] }>('/api/v1/dev/zalo-bot', { body: { text } });
      setMessages(r.messages);
      setText('');
      router.refresh(); // linking, accepting… change what the page shows
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không gửi được');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="bot-simulator">
      <div className="flex h-80 flex-col gap-2 overflow-y-auto rounded-lg bg-muted/60 p-3" role="log" aria-label="Tin nhắn với Zalo Bot">
        {messages.length === 0 && <p className="m-auto text-sm text-muted-foreground">Chưa có tin nhắn. Gõ HELP để bắt đầu.</p>}
        {messages.map((m, i) => (
          <p
            key={`${m.at}-${i}`}
            className={cn(
              'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line',
              m.from === 'user' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-surface shadow-sm',
            )}
            data-from={m.from ?? 'bot'}
          >
            {m.text}
          </p>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nhắn cho bot, vd: HOMNAY" aria-label="Tin nhắn gửi bot" autoComplete="off" />
        <Button type="submit" disabled={busy}>
          Gửi
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-accent-text">
          {error}
        </p>
      )}
    </div>
  );
}
