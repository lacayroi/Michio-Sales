// Zalo Bot (SPEC 5.5) — internal notification channel for sales, never used to message customers.
// Platform facts checked against https://bot.zaloplatforms.com/docs (16/10/2026), see docs/DECISIONS.md D-022.
import { timingSafeEqual } from 'node:crypto';

export const ZALO_BOT = {
  apiBase: 'https://bot-api.zaloplatforms.com',
  /** Header Zalo sends with every webhook call; value = secret_token given to setWebhook. */
  secretHeader: 'x-bot-api-secret-token',
  /** sendMessage: text length 1–2000 characters. */
  maxTextLength: 2000,
  /** setWebhook: secret_token length 8–256. */
  secretMinLength: 8,
  secretMaxLength: 256,
} as const;

export class ZaloBotApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | null,
    description: string,
  ) {
    super(`Zalo Bot ${method} failed (${errorCode ?? 'network'}): ${description}`);
    this.name = 'ZaloBotApiError';
  }
  /** 429 quota / 408 timeout / network errors are worth retrying; 400/401/404 are not. */
  get retryable() {
    return this.errorCode === null || this.errorCode === 429 || this.errorCode === 408 || this.errorCode >= 500;
  }
}

export interface ZaloBotSendResult {
  messageId: string;
}

export interface ZaloBotClient {
  readonly mode: 'live' | 'mock';
  sendMessage(chatId: string, text: string): Promise<ZaloBotSendResult>;
  getMe(): Promise<{ id: string; name: string } & Record<string, unknown>>;
  setWebhook(url: string, secretToken: string): Promise<Record<string, unknown>>;
  deleteWebhook(): Promise<Record<string, unknown>>;
  getWebhookInfo(): Promise<Record<string, unknown>>;
  /** Long polling; only works when no webhook is set (the two modes are mutually exclusive). */
  getUpdates(timeoutSeconds?: number): Promise<unknown>;
}

/** Fit a message into one Zalo text (1–2000 chars). */
export function clampText(text: string): string {
  const t = text.trim() || '…';
  return t.length <= ZALO_BOT.maxTextLength ? t : `${t.slice(0, ZALO_BOT.maxTextLength - 1)}…`;
}

interface Envelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export function createZaloBotHttpClient(token: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): ZaloBotClient {
  if (!token) throw new Error('ZALO_BOT_TOKEN is not set');
  const doFetch = opts.fetch ?? fetch;

  async function call<T>(method: string, body?: Record<string, unknown>, timeoutMs = opts.timeoutMs ?? 10_000): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${ZALO_BOT.apiBase}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ZaloBotApiError(method, null, err instanceof Error ? err.message : String(err));
    }
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!json?.ok) throw new ZaloBotApiError(method, json?.error_code ?? res.status, json?.description ?? res.statusText);
    return json.result as T;
  }

  return {
    mode: 'live',
    async sendMessage(chatId, text) {
      const r = await call<{ message_id: string }>('sendMessage', { chat_id: chatId, text: clampText(text) });
      return { messageId: String(r.message_id) };
    },
    getMe: () => call('getMe'),
    setWebhook: (url, secretToken) => {
      if (!url.startsWith('https://')) throw new Error('Webhook Zalo Bot phải là địa chỉ HTTPS công khai');
      if (secretToken.length < ZALO_BOT.secretMinLength || secretToken.length > ZALO_BOT.secretMaxLength) {
        throw new Error(`ZALO_BOT_WEBHOOK_SECRET phải dài ${ZALO_BOT.secretMinLength}–${ZALO_BOT.secretMaxLength} ký tự`);
      }
      return call('setWebhook', { url, secret_token: secretToken });
    },
    deleteWebhook: () => call('deleteWebhook'),
    getWebhookInfo: () => call('getWebhookInfo'),
    getUpdates: (timeoutSeconds = 30) => call('getUpdates', { timeout: String(timeoutSeconds) }, (timeoutSeconds + 5) * 1000),
  };
}

/** Where the mock client writes outgoing messages (Redis list in dev, array in tests). */
export interface MockOutbox {
  push(message: { chatId: string; text: string; at: string }): Promise<void>;
}

/** MOCK_INTEGRATIONS=true: no network; messages land in `outbox` so the demo simulator can show them. */
export function createZaloBotMockClient(outbox: MockOutbox): ZaloBotClient {
  let n = 0;
  return {
    mode: 'mock',
    async sendMessage(chatId, text) {
      await outbox.push({ chatId, text: clampText(text), at: new Date().toISOString() });
      return { messageId: `mock-${Date.now()}-${++n}` };
    },
    async getMe() {
      return { id: 'mock-bot', name: 'Michio Sales Bot (mô phỏng)' };
    },
    async setWebhook(url) {
      return { url, verification: { outcome: 'webhook.mock' } };
    },
    async deleteWebhook() {
      return {};
    },
    async getWebhookInfo() {
      return { url: null, mock: true };
    },
    async getUpdates() {
      return [];
    },
  };
}

/** Constant-time check of the X-Bot-Api-Secret-Token header. */
export function verifyZaloBotSecret(received: string | null | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ZaloBotUpdate {
  eventName: string;
  messageId: string | null;
  chatId: string;
  chatType: string | null;
  fromId: string | null;
  displayName: string | null;
  /** Only for message.text.received */
  text: string | null;
  date: number | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/**
 * Webhook body / getUpdates item → update. Documented shape: { ok, result: { event_name, message: {
 * from: {id, display_name, is_bot}, chat: {id, chat_type}, text, message_id, date } } }.
 * Accepts the inner `result` too. Returns null when there is no chat to answer.
 */
export function parseZaloBotUpdate(payload: unknown): ZaloBotUpdate | null {
  const root = obj(payload);
  const result = obj(root?.result) ?? root;
  const message = obj(result?.message);
  const chat = obj(message?.chat);
  const from = obj(message?.from);
  const chatId = str(chat?.id) ?? str(from?.id);
  if (!result || !message || !chatId) return null;
  return {
    eventName: str(result.event_name) ?? 'unknown',
    messageId: str(message.message_id),
    chatId,
    chatType: str(chat?.chat_type),
    fromId: str(from?.id),
    displayName: str(from?.display_name),
    text: typeof message.text === 'string' ? message.text : null,
    date: typeof message.date === 'number' ? message.date : null,
  };
}

/** getUpdates returns one update or a list depending on traffic; normalize to a list. */
export function parseZaloBotUpdates(result: unknown): ZaloBotUpdate[] {
  const items = Array.isArray(result) ? result : result ? [result] : [];
  return items.map((i) => parseZaloBotUpdate(i)).filter((u): u is ZaloBotUpdate => u !== null);
}
