// Facebook Page — Messenger & Lead Ads (SPEC 5.2). Platform facts checked against Meta docs on
// 17/10/2026 (SPEC 0.1.5) and kept here only — see docs/DECISIONS.md D-028.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const FACEBOOK = {
  graphBase: 'https://graph.facebook.com',
  dialogBase: 'https://www.facebook.com',
  /** Graph API v26.0 released 29/07/2026; override with FB_GRAPH_VERSION. */
  defaultGraphVersion: 'v26.0',
  /** POST webhooks carry `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(raw body, App Secret)>`. */
  signatureHeader: 'x-hub-signature-256',
  /** Meta expects a 200 within 5 seconds, retries for a while, then disables the subscription. */
  webhookResponseSeconds: 5,
  /** Standard messaging window after the customer's last message (Messenger policy). */
  standardWindowHours: 24,
  /** HUMAN_AGENT tag: manual replies within 7 days, only for approved use cases. */
  humanAgentWindowDays: 7,
  /** Page fields the app subscribes to (POST /{page-id}/subscribed_apps). */
  subscribedFields: ['messages', 'messaging_postbacks', 'message_echoes', 'message_deliveries', 'message_reads', 'leadgen'],
  /** Permissions requested in the Owner's Facebook login (need Meta App Review for real customers). */
  scopes: ['pages_show_list', 'pages_messaging', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval', 'pages_manage_ads'],
} as const;

export const graphVersion = () => process.env.FB_GRAPH_VERSION?.trim() || FACEBOOK.defaultGraphVersion;

// ---------- signature ----------

export function signFacebookPayload(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Constant-time check of X-Hub-Signature-256 against the raw request body. */
export function verifyFacebookSignature(rawBody: string, header: string | null | undefined, appSecret: string | undefined): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(signFacebookPayload(rawBody, appSecret));
  const got = Buffer.from(header.trim().toLowerCase());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// ---------- messaging window ----------

export interface WindowPolicy {
  standardWindowHours: number;
  humanAgentWindowDays: number;
  useHumanAgentTag: boolean;
}

export type WindowState =
  | { ok: true; mode: 'standard' | 'human_agent'; closesAt: Date }
  | { ok: false; reason: string };

/** Whether a Page may still message a user whose last message was at `lastInboundAt` (SPEC 5.2). */
export function messengerWindow(lastInboundAt: Date | null, now: Date, policy: WindowPolicy): WindowState {
  if (!lastInboundAt) return { ok: false, reason: 'Khách chưa nhắn cho Page nên chưa thể gửi tin qua Messenger.' };
  const standard = new Date(lastInboundAt.getTime() + policy.standardWindowHours * 3600_000);
  if (now < standard) return { ok: true, mode: 'standard', closesAt: standard };
  if (policy.useHumanAgentTag) {
    const human = new Date(lastInboundAt.getTime() + policy.humanAgentWindowDays * 86_400_000);
    if (now < human) return { ok: true, mode: 'human_agent', closesAt: human };
    return { ok: false, reason: `Đã quá ${policy.humanAgentWindowDays} ngày kể từ tin cuối của khách — Messenger không cho phép nhắn tiếp.` };
  }
  return { ok: false, reason: `Đã quá ${policy.standardWindowHours} giờ kể từ tin cuối của khách — Messenger không cho phép nhắn tiếp.` };
}

// ---------- webhook parsing ----------

export interface FbAttachment {
  type: string; // image | file | audio | video | sticker | fallback | template
  url: string | null;
  stickerId?: string | null;
}

export type FacebookEvent =
  | {
      kind: 'message';
      pageId: string;
      psid: string;
      mid: string;
      timestamp: number;
      text: string | null;
      attachments: FbAttachment[];
      /** Sent by the Page itself (Page inbox, our own Send API calls echo back too). */
      isEcho: boolean;
      /** For echoes: the app that sent it (ours → already stored). */
      appId: string | null;
    }
  | { kind: 'postback'; pageId: string; psid: string; mid: string; timestamp: number; title: string; payload: string | null }
  | { kind: 'delivery' | 'read'; pageId: string; psid: string; watermark: number; mids: string[] }
  | { kind: 'leadgen'; pageId: string; leadgenId: string; formId: string | null; adId: string | null; createdTime: number | null };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);

function parseAttachments(v: unknown): FbAttachment[] {
  return arr(v).map((a) => {
    const o = obj(a) ?? {};
    const payload = obj(o.payload) ?? {};
    const stickerId = str(payload.sticker_id);
    return { type: stickerId ? 'sticker' : str(o.type) ?? 'fallback', url: str(payload.url), stickerId };
  });
}

/**
 * `{object:'page', entry:[{id, time, messaging:[…], changes:[…]}]}` → flat list of events we handle.
 * Unknown event types are ignored (Meta adds fields over time).
 */
export function parseFacebookWebhook(body: unknown): FacebookEvent[] {
  const root = obj(body);
  if (!root || root.object !== 'page') return [];
  const out: FacebookEvent[] = [];
  for (const e of arr(root.entry)) {
    const entry = obj(e);
    if (!entry) continue;
    const entryPage = str(entry.id) ?? '';
    for (const m of arr(entry.messaging)) {
      const ev = obj(m);
      if (!ev) continue;
      const sender = str(obj(ev.sender)?.id);
      const recipient = str(obj(ev.recipient)?.id);
      const timestamp = num(ev.timestamp) ?? Date.now();
      const message = obj(ev.message);
      if (message) {
        const isEcho = message.is_echo === true;
        const pageId = (isEcho ? sender : recipient) ?? entryPage;
        const psid = isEcho ? recipient : sender;
        const mid = str(message.mid);
        if (!psid || !mid) continue;
        out.push({ kind: 'message', pageId, psid, mid, timestamp, text: str(message.text), attachments: parseAttachments(message.attachments), isEcho, appId: isEcho ? str(message.app_id) : null });
        continue;
      }
      const postback = obj(ev.postback);
      if (postback && sender) {
        out.push({
          kind: 'postback', pageId: recipient ?? entryPage, psid: sender, timestamp,
          mid: str(postback.mid) ?? `postback-${sender}-${timestamp}`, title: str(postback.title) ?? '', payload: str(postback.payload),
        });
        continue;
      }
      const delivery = obj(ev.delivery);
      const read = obj(ev.read);
      if ((delivery || read) && sender) {
        const d = (delivery ?? read)!;
        out.push({ kind: delivery ? 'delivery' : 'read', pageId: recipient ?? entryPage, psid: sender, watermark: num(d.watermark) ?? timestamp, mids: arr(d.mids).map(str).filter((x): x is string => !!x) });
      }
    }
    for (const c of arr(entry.changes)) {
      const change = obj(c);
      if (change?.field !== 'leadgen') continue;
      const v = obj(change.value) ?? {};
      const leadgenId = str(v.leadgen_id);
      if (!leadgenId) continue;
      out.push({ kind: 'leadgen', pageId: str(v.page_id) ?? entryPage, leadgenId, formId: str(v.form_id), adId: str(v.ad_id), createdTime: num(v.created_time) });
    }
  }
  return out;
}

/** Idempotency key per event: Meta retries deliveries, so the same mid / leadgen id may arrive twice. */
export function facebookEventKey(e: FacebookEvent): string | null {
  switch (e.kind) {
    case 'message':
    case 'postback':
      return `facebook:${e.kind}:${e.mid}`;
    case 'leadgen':
      return `facebook:leadgen:${e.leadgenId}`;
    default:
      return null; // delivery/read receipts are applied directly, not stored
  }
}

// ---------- Lead Ads field mapping ----------

export interface LeadAdsLead {
  id: string;
  createdTime: string | null;
  formId: string | null;
  adId: string | null;
  fields: Record<string, string>;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_');

/** Standard Lead Ads keys plus common Vietnamese custom-question labels → intake fields. */
export function mapLeadAdsFields(fields: Record<string, string>) {
  const get = (...keys: string[]) => {
    for (const [k, v] of Object.entries(fields)) if (v && keys.includes(fold(k))) return v;
    return undefined;
  };
  const first = get('first_name');
  const last = get('last_name');
  return {
    fullName: get('full_name', 'ho_ten', 'ho_va_ten', 'ten') ?? ([last, first].filter(Boolean).join(' ') || undefined),
    phone: get('phone_number', 'phone', 'so_dien_thoai', 'sdt', 'dien_thoai'),
    email: get('email'),
    province: get('city', 'state', 'province', 'tinh_thanh', 'tinh_thanh_pho', 'khu_vuc', 'tinh'),
    shopName: get('company_name', 'ten_shop', 'ten_cua_hang', 'ten_shop_doanh_nghiep', 'cong_ty'),
    businessModel: get('mo_hinh_kinh_doanh', 'mo_hinh', 'job_title'),
    expectedOrderBand: get('muc_nhap_du_kien', 'muc_nhap'),
    interest: get('nhom_hang_quan_tam', 'quan_tam', 'san_pham_quan_tam'),
    note: get('ghi_chu', 'note', 'nhu_cau'),
  };
}

// ---------- Graph API client ----------

export class FacebookApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    readonly fbCode: number | null,
    message: string,
  ) {
    super(`Facebook ${path} failed (${fbCode ?? status ?? 'network'}): ${message}`);
    this.name = 'FacebookApiError';
  }
  /** Rate limits / transient errors are retried; bad tokens, policy blocks are not. */
  get retryable() {
    if (this.status === null) return true;
    if (this.fbCode !== null && [4, 17, 32, 613, 1, 2].includes(this.fbCode)) return true;
    return this.status >= 500 || this.status === 429;
  }
  /** Token expired / revoked / missing permission → mark the channel ERROR and tell the Owner. */
  get authProblem() {
    return this.fbCode === 190 || this.fbCode === 102 || this.fbCode === 10 || (this.fbCode !== null && this.fbCode >= 200 && this.fbCode < 300);
  }
}

export interface FbSendInput {
  pageId: string;
  pageToken: string;
  psid: string;
  kind: 'text' | 'image' | 'file';
  text?: string;
  attachmentUrl?: string;
  /** Outside the 24 h window when the HUMAN_AGENT tag is enabled. */
  humanAgentTag?: boolean;
}

export interface FbPage {
  id: string;
  name: string;
  accessToken: string;
}

export interface FacebookClient {
  readonly mode: 'live' | 'mock';
  send(input: FbSendInput): Promise<{ messageId: string }>;
  getProfile(psid: string, pageToken: string): Promise<{ name: string | null; avatarUrl: string | null }>;
  getLead(leadgenId: string, pageToken: string): Promise<LeadAdsLead>;
  /** OAuth: code → long-lived user token → pages with (non-expiring) page tokens. */
  exchangeCode(code: string, redirectUri: string): Promise<{ userToken: string; expiresAt: Date | null }>;
  listPages(userToken: string): Promise<FbPage[]>;
  subscribePage(pageId: string, pageToken: string): Promise<void>;
  /** Cheap token check for `facebook-token-check`. */
  checkPageToken(pageId: string, pageToken: string): Promise<{ ok: true; name: string } | { ok: false; error: string }>;
}

export interface FacebookAppConfig {
  appId: string;
  appSecret: string;
  version?: string;
}

/** OAuth dialog URL the Owner is sent to from Cài đặt → Facebook. */
export function facebookLoginUrl(cfg: { appId: string; version?: string }, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: cfg.appId, redirect_uri: redirectUri, state, response_type: 'code', scope: FACEBOOK.scopes.join(',') });
  return `${FACEBOOK.dialogBase}/${cfg.version ?? graphVersion()}/dialog/oauth?${q}`;
}

export function createFacebookHttpClient(cfg: FacebookAppConfig, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): FacebookClient {
  const doFetch = opts.fetch ?? fetch;
  const version = cfg.version ?? graphVersion();

  async function call<T>(path: string, init: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${FACEBOOK.graphBase}/${version}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: init.method ?? 'GET',
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new FacebookApiError(path, null, null, err instanceof Error ? err.message : String(err));
    }
    const json = (await res.json().catch(() => null)) as (Obj & { error?: { message?: string; code?: number } }) | null;
    if (!res.ok || json?.error) throw new FacebookApiError(path, res.status, json?.error?.code ?? null, json?.error?.message ?? res.statusText);
    return json as T;
  }

  return {
    mode: 'live',
    async send(i) {
      const message =
        i.kind === 'text'
          ? { text: i.text ?? '' }
          : { attachment: { type: i.kind === 'image' ? 'image' : 'file', payload: { url: i.attachmentUrl, is_reusable: false } } };
      const body = {
        recipient: { id: i.psid },
        messaging_type: i.humanAgentTag ? 'MESSAGE_TAG' : 'RESPONSE',
        ...(i.humanAgentTag ? { tag: 'HUMAN_AGENT' } : {}),
        message,
      };
      const r = await call<{ message_id: string }>(`${i.pageId}/messages`, { method: 'POST', query: { access_token: i.pageToken }, body });
      return { messageId: r.message_id };
    },
    async getProfile(psid, pageToken) {
      try {
        const r = await call<{ name?: string; first_name?: string; last_name?: string; profile_pic?: string }>(psid, { query: { fields: 'name,first_name,last_name,profile_pic', access_token: pageToken } });
        return { name: r.name ?? ([r.last_name, r.first_name].filter(Boolean).join(' ') || null), avatarUrl: r.profile_pic ?? null };
      } catch {
        return { name: null, avatarUrl: null }; // profile access can be restricted; never block intake on it
      }
    },
    async getLead(leadgenId, pageToken) {
      const r = await call<{ id: string; created_time?: string; form_id?: string; ad_id?: string; field_data?: { name: string; values?: string[] }[] }>(leadgenId, {
        query: { access_token: pageToken, fields: 'id,created_time,form_id,ad_id,field_data' },
      });
      return {
        id: r.id,
        createdTime: r.created_time ?? null,
        formId: r.form_id ?? null,
        adId: r.ad_id ?? null,
        fields: Object.fromEntries((r.field_data ?? []).map((f) => [f.name, (f.values ?? []).join(', ')])),
      };
    },
    async exchangeCode(code, redirectUri) {
      const short = await call<{ access_token: string }>('oauth/access_token', { query: { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: redirectUri, code } });
      const long = await call<{ access_token: string; expires_in?: number }>('oauth/access_token', {
        query: { grant_type: 'fb_exchange_token', client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: short.access_token },
      });
      return { userToken: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null };
    },
    async listPages(userToken) {
      const r = await call<{ data: { id: string; name: string; access_token: string }[] }>('me/accounts', { query: { access_token: userToken, fields: 'id,name,access_token', limit: '100' } });
      return r.data.map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token }));
    },
    async subscribePage(pageId, pageToken) {
      await call(`${pageId}/subscribed_apps`, { method: 'POST', query: { access_token: pageToken, subscribed_fields: FACEBOOK.subscribedFields.join(',') } });
    },
    async checkPageToken(pageId, pageToken) {
      try {
        const r = await call<{ name: string }>(pageId, { query: { fields: 'name', access_token: pageToken } });
        return { ok: true, name: r.name };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

// ---------- mock (MOCK_INTEGRATIONS=true) ----------

export interface FacebookMockOutbox {
  push(m: { pageId: string; psid: string; kind: string; text?: string; attachmentUrl?: string; messageId: string; at: string }): Promise<void>;
}

/** Same contract, no network: sent messages land in `outbox`; profiles and leads are synthesized. */
export function createFacebookMockClient(
  outbox: FacebookMockOutbox,
  leads: Record<string, LeadAdsLead> = {},
  /** Demo simulator can name its customers. */
  profileName: (psid: string) => Promise<string | null> = async () => null,
): FacebookClient {
  let n = 0;
  return {
    mode: 'mock',
    async send(i) {
      const messageId = `m_mock_${Date.now()}_${++n}`;
      await outbox.push({ pageId: i.pageId, psid: i.psid, kind: i.kind, text: i.text, attachmentUrl: i.attachmentUrl, messageId, at: new Date().toISOString() });
      return { messageId };
    },
    async getProfile(psid) {
      return { name: (await profileName(psid)) ?? `Khách Facebook ${psid.slice(-4)}`, avatarUrl: null };
    },
    async getLead(leadgenId) {
      return (
        leads[leadgenId] ?? {
          id: leadgenId,
          createdTime: new Date().toISOString(),
          formId: 'mock-form',
          adId: null,
          fields: { full_name: `Khách Lead Ads ${leadgenId.slice(-4)}`, phone_number: `09${leadgenId.replace(/\D/g, '').padStart(8, '0').slice(-8)}`, city: 'Hà Nội' },
        }
      );
    },
    async exchangeCode() {
      return { userToken: 'mock-user-token', expiresAt: null };
    },
    async listPages() {
      return [{ id: 'mock-page-michio', name: 'Michio - Hàng Nhật nội địa (mô phỏng)', accessToken: 'mock-page-token' }];
    },
    async subscribePage() {},
    async checkPageToken() {
      return { ok: true, name: 'Michio (mô phỏng)' };
    },
  };
}
