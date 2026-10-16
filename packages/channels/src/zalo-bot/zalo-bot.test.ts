import { describe, expect, it, vi } from 'vitest';
import {
  clampText,
  createZaloBotHttpClient,
  createZaloBotMockClient,
  parseZaloBotUpdate,
  parseZaloBotUpdates,
  verifyZaloBotSecret,
  ZaloBotApiError,
} from '.';

// Sample shape from https://bot.zaloplatforms.com/docs/webhook/
const SAMPLE = {
  ok: true,
  result: {
    event_name: 'message.text.received',
    message: {
      from: { id: '6ede9afa66b88fe6d6a9', display_name: 'Ted', is_bot: false },
      chat: { id: '6ede9afa66b88fe6d6a9', chat_type: 'PRIVATE' },
      text: 'NHAN 1234',
      message_id: '2d758cb5e222177a4e35',
      date: 1750316131602,
    },
  },
};

describe('parseZaloBotUpdate', () => {
  it('reads the documented webhook payload', () => {
    expect(parseZaloBotUpdate(SAMPLE)).toEqual({
      eventName: 'message.text.received',
      messageId: '2d758cb5e222177a4e35',
      chatId: '6ede9afa66b88fe6d6a9',
      chatType: 'PRIVATE',
      fromId: '6ede9afa66b88fe6d6a9',
      displayName: 'Ted',
      text: 'NHAN 1234',
      date: 1750316131602,
    });
  });

  it('accepts the inner result object and non-text events', () => {
    const u = parseZaloBotUpdate({ event_name: 'message.sticker.received', message: { chat: { id: 'c1' }, message_id: 'm', sticker: 'x' } });
    expect(u).toMatchObject({ eventName: 'message.sticker.received', chatId: 'c1', text: null });
  });

  it('returns null for garbage', () => {
    expect(parseZaloBotUpdate(null)).toBeNull();
    expect(parseZaloBotUpdate({ ok: true, result: {} })).toBeNull();
    expect(parseZaloBotUpdates([SAMPLE, { nope: 1 }])).toHaveLength(1);
    expect(parseZaloBotUpdates(SAMPLE.result)).toHaveLength(1);
  });
});

describe('verifyZaloBotSecret', () => {
  it('compares in constant time and rejects missing values', () => {
    expect(verifyZaloBotSecret('secret-123', 'secret-123')).toBe(true);
    expect(verifyZaloBotSecret('secret-124', 'secret-123')).toBe(false);
    expect(verifyZaloBotSecret('short', 'secret-123')).toBe(false);
    expect(verifyZaloBotSecret(null, 'secret-123')).toBe(false);
    expect(verifyZaloBotSecret('x', undefined)).toBe(false);
  });
});

describe('http client', () => {
  it('calls https://bot-api.zaloplatforms.com/bot<TOKEN>/sendMessage with chat_id + text', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 'abc', date: 1 } })));
    const client = createZaloBotHttpClient('123:tok', { fetch });
    await expect(client.sendMessage('chat-1', 'Xin chào')).resolves.toEqual({ messageId: 'abc' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://bot-api.zaloplatforms.com/bot123:tok/sendMessage');
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: 'chat-1', text: 'Xin chào' });
  });

  it('maps API errors; 429 is retryable, 401 is not', async () => {
    const quota = createZaloBotHttpClient('t', { fetch: async () => new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Quota exceeded' }), { status: 429 }) });
    const err = await quota.sendMessage('c', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(ZaloBotApiError);
    expect(err.retryable).toBe(true);
    const bad = createZaloBotHttpClient('t', { fetch: async () => new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' })) });
    expect((await bad.getMe().catch((e) => e)).retryable).toBe(false);
  });

  it('validates setWebhook input like the platform does', async () => {
    const client = createZaloBotHttpClient('t', { fetch: async () => new Response(JSON.stringify({ ok: true, result: {} })) });
    expect(() => client.setWebhook('http://x.vn/hook', 'secret-123')).toThrow(/HTTPS/);
    expect(() => client.setWebhook('https://x.vn/hook', 'short')).toThrow(/8–256/);
  });
});

describe('mock client & clampText', () => {
  it('writes to the outbox and clamps to 2000 chars', async () => {
    const sent: { chatId: string; text: string }[] = [];
    const client = createZaloBotMockClient({ push: async (m) => void sent.push(m) });
    await client.sendMessage('c', 'a'.repeat(2500));
    expect(sent[0]!.text).toHaveLength(2000);
    expect(clampText('  ')).toBe('…');
  });
});
