import { describe, expect, it, vi } from 'vitest';
import { leadgenPayload, messengerEchoPayload, messengerMessagePayload, signedRequest } from '../../test/mocks/facebook';
import { createMessengerGateway, MessagingWindowClosedError } from './gateway';
import {
  createFacebookHttpClient,
  createFacebookMockClient,
  FacebookApiError,
  facebookEventKey,
  facebookLoginUrl,
  mapLeadAdsFields,
  messengerWindow,
  parseFacebookWebhook,
  verifyFacebookSignature,
} from '.';

const SECRET = 'app-secret-123';

describe('verifyFacebookSignature', () => {
  it('accepts the sha256= HMAC of the raw body and rejects anything else', () => {
    const { body, signature } = signedRequest(messengerMessagePayload({ pageId: 'P', psid: 'U', text: 'Chào shop' }), SECRET);
    expect(verifyFacebookSignature(body, signature, SECRET)).toBe(true);
    expect(verifyFacebookSignature(body, signature.toUpperCase().replace('SHA256=', 'sha256='), SECRET)).toBe(true); // hex case-insensitive
    expect(verifyFacebookSignature(`${body} `, signature, SECRET)).toBe(false);
    expect(verifyFacebookSignature(body, signature, 'other')).toBe(false);
    expect(verifyFacebookSignature(body, signature.replace('sha256=', 'sha1='), SECRET)).toBe(false);
    expect(verifyFacebookSignature(body, null, SECRET)).toBe(false);
    expect(verifyFacebookSignature(body, signature, undefined)).toBe(false);
  });

  it('signs the exact UTF-8 bytes (Vietnamese text)', () => {
    const { body, signature } = signedRequest({ object: 'page', entry: [{ messaging: [{ message: { text: 'Đặt hàng matcha ạ' } }] }] }, SECRET);
    expect(verifyFacebookSignature(body, signature, SECRET)).toBe(true);
  });
});

describe('parseFacebookWebhook', () => {
  it('parses text, attachments and stickers', () => {
    const [text] = parseFacebookWebhook(messengerMessagePayload({ pageId: 'P1', psid: 'U1', text: 'Báo giá matcha', mid: 'm1', timestamp: 1000 }));
    expect(text).toEqual({ kind: 'message', pageId: 'P1', psid: 'U1', mid: 'm1', timestamp: 1000, text: 'Báo giá matcha', attachments: [], isEcho: false, appId: null });
    const [img] = parseFacebookWebhook(messengerMessagePayload({ pageId: 'P1', psid: 'U1', attachments: [{ type: 'image', url: 'https://x/a.jpg' }] }));
    expect(img).toMatchObject({ kind: 'message', text: null, attachments: [{ type: 'image', url: 'https://x/a.jpg' }] });
    const [sticker] = parseFacebookWebhook(messengerMessagePayload({ pageId: 'P1', psid: 'U1', stickerId: 369239263222822 }));
    expect(sticker).toMatchObject({ attachments: [{ type: 'sticker', stickerId: '369239263222822' }] });
  });

  it('flips sender/recipient for echoes', () => {
    const [e] = parseFacebookWebhook(messengerEchoPayload({ pageId: 'P1', psid: 'U9', text: 'Dạ shop chào chị', mid: 'm2' }));
    expect(e).toMatchObject({ kind: 'message', pageId: 'P1', psid: 'U9', isEcho: true, mid: 'm2' });
  });

  it('parses postbacks, delivery/read receipts and leadgen changes', () => {
    const events = parseFacebookWebhook({
      object: 'page',
      entry: [
        {
          id: 'P1',
          messaging: [
            { sender: { id: 'U1' }, recipient: { id: 'P1' }, timestamp: 5, postback: { title: 'Bắt đầu', payload: 'GET_STARTED', mid: 'pb1' } },
            { sender: { id: 'U1' }, recipient: { id: 'P1' }, timestamp: 6, delivery: { mids: ['m1'], watermark: 6 } },
            { sender: { id: 'U1' }, recipient: { id: 'P1' }, timestamp: 7, read: { watermark: 7 } },
          ],
        },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(['postback', 'delivery', 'read']);
    const [lg] = parseFacebookWebhook(leadgenPayload({ pageId: 'P1', leadgenId: '444', formId: 'F' }));
    expect(lg).toMatchObject({ kind: 'leadgen', pageId: 'P1', leadgenId: '444', formId: 'F' });
  });

  it('ignores other objects and malformed entries', () => {
    expect(parseFacebookWebhook({ object: 'instagram', entry: [] })).toEqual([]);
    expect(parseFacebookWebhook(null)).toEqual([]);
    expect(parseFacebookWebhook({ object: 'page', entry: [{ messaging: [{ message: { text: 'no mid' } }] }] })).toEqual([]);
  });

  it('gives stable idempotency keys', () => {
    const [m] = parseFacebookWebhook(messengerMessagePayload({ pageId: 'P', psid: 'U', text: 'a', mid: 'mid.1' }));
    expect(facebookEventKey(m!)).toBe('facebook:message:mid.1');
    const [lg] = parseFacebookWebhook(leadgenPayload({ pageId: 'P', leadgenId: '9' }));
    expect(facebookEventKey(lg!)).toBe('facebook:leadgen:9');
  });
});

describe('messengerWindow', () => {
  const policy = { standardWindowHours: 24, humanAgentWindowDays: 7, useHumanAgentTag: false };
  const last = new Date('2026-10-10T03:00:00Z');
  it('is open for 24 h after the last customer message', () => {
    expect(messengerWindow(last, new Date('2026-10-11T02:59:00Z'), policy)).toMatchObject({ ok: true, mode: 'standard' });
    const closed = messengerWindow(last, new Date('2026-10-11T03:00:00Z'), policy);
    expect(closed.ok).toBe(false);
    expect(!closed.ok && closed.reason).toContain('24 giờ');
  });
  it('extends to 7 days with the HUMAN_AGENT tag when enabled', () => {
    const p = { ...policy, useHumanAgentTag: true };
    expect(messengerWindow(last, new Date('2026-10-16T00:00:00Z'), p)).toMatchObject({ ok: true, mode: 'human_agent' });
    expect(messengerWindow(last, new Date('2026-10-17T03:00:00Z'), p).ok).toBe(false);
  });
  it('is closed when the customer never wrote', () => {
    expect(messengerWindow(null, last, policy).ok).toBe(false);
  });
});

describe('mapLeadAdsFields', () => {
  it('maps standard and Vietnamese custom fields', () => {
    expect(mapLeadAdsFields({ full_name: 'Nguyễn Thị Hoa', phone_number: '+84912345678', email: 'h@x.vn', city: 'Hải Phòng', 'Tên shop': 'Shop Hoa', 'Mô hình kinh doanh': 'Shop online', 'Mức nhập dự kiến': '10–30 triệu' })).toMatchObject({
      fullName: 'Nguyễn Thị Hoa', phone: '+84912345678', email: 'h@x.vn', province: 'Hải Phòng', shopName: 'Shop Hoa', businessModel: 'Shop online', expectedOrderBand: '10–30 triệu',
    });
    expect(mapLeadAdsFields({ first_name: 'Hoa', last_name: 'Nguyễn' }).fullName).toBe('Nguyễn Hoa');
  });
});

describe('Graph HTTP client', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('sends text with RESPONSE and attachments / HUMAN_AGENT correctly', async () => {
    const fetch = vi.fn(async () => ok({ recipient_id: 'U', message_id: 'mid.out' }));
    const c = createFacebookHttpClient({ appId: 'A', appSecret: 'S', version: 'v26.0' }, { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await c.send({ pageId: 'P', pageToken: 'T', psid: 'U', kind: 'text', text: 'Chào chị' })).toEqual({ messageId: 'mid.out' });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://graph.facebook.com/v26.0/P/messages?access_token=T');
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { id: 'U' }, messaging_type: 'RESPONSE', message: { text: 'Chào chị' } });
    await c.send({ pageId: 'P', pageToken: 'T', psid: 'U', kind: 'file', attachmentUrl: 'https://s3/bg.pdf', humanAgentTag: true });
    const [, init2] = fetch.mock.calls[1] as unknown as [URL, RequestInit];
    expect(JSON.parse(init2.body as string)).toEqual({
      recipient: { id: 'U' }, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT', message: { attachment: { type: 'file', payload: { url: 'https://s3/bg.pdf', is_reusable: false } } },
    });
  });

  it('maps Graph errors, retryability and token problems', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Session has expired', code: 190 } }), { status: 400 }));
    const c = createFacebookHttpClient({ appId: 'A', appSecret: 'S' }, { fetch: fetch as unknown as typeof globalThis.fetch });
    const err = await c.send({ pageId: 'P', pageToken: 'T', psid: 'U', kind: 'text', text: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(FacebookApiError);
    expect(err.authProblem).toBe(true);
    expect(err.retryable).toBe(false);
    expect(new FacebookApiError('x', 400, 613, 'rate').retryable).toBe(true);
    expect(new FacebookApiError('x', null, null, 'net').retryable).toBe(true);
  });

  it('reads Lead Ads field_data', async () => {
    const fetch = vi.fn(async () => ok({ id: 'L1', form_id: 'F', field_data: [{ name: 'full_name', values: ['Hoa'] }, { name: 'phone_number', values: ['0912345678'] }] }));
    const c = createFacebookHttpClient({ appId: 'A', appSecret: 'S' }, { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await c.getLead('L1', 'T')).toMatchObject({ id: 'L1', formId: 'F', fields: { full_name: 'Hoa', phone_number: '0912345678' } });
  });

  it('builds the OAuth dialog URL with the required scopes', () => {
    const u = new URL(facebookLoginUrl({ appId: '123', version: 'v26.0' }, 'https://sales.x/cb', 'st'));
    expect(u.pathname).toBe('/v26.0/dialog/oauth');
    expect(u.searchParams.get('scope')).toContain('pages_messaging');
    expect(u.searchParams.get('scope')).toContain('leads_retrieval');
    expect(u.searchParams.get('state')).toBe('st');
  });
});

describe('Messenger gateway', () => {
  const outbox: unknown[] = [];
  const client = createFacebookMockClient({ push: async (m) => void outbox.push(m) });
  const deps = {
    client,
    pageOf: async () => ({ pageId: 'P', pageToken: 'T' }),
    windowOf: async (id: string) => (id === 'open' ? { ok: true as const, mode: 'standard' as const, closesAt: new Date() } : { ok: false as const, reason: 'Hết khung' }),
    windowForRecipient: async (_a: string, psid: string) =>
      psid === 'U-open' ? { ok: true as const, mode: 'standard' as const, closesAt: new Date() } : { ok: false as const, reason: 'Hết khung' },
  };
  const gw = createMessengerGateway(deps);

  it('reports the window through canSend', async () => {
    expect(await gw.canSend('open')).toEqual({ ok: true });
    expect(await gw.canSend('closed')).toEqual({ ok: false, reason: 'Hết khung' });
  });

  it('refuses to send outside the window and sends inside it', async () => {
    await expect(gw.send({ channelAccountId: 'C', externalUserId: 'U-closed', kind: 'text', text: 'x', idempotencyKey: 'k1' })).rejects.toBeInstanceOf(MessagingWindowClosedError);
    const r = await gw.send({ channelAccountId: 'C', externalUserId: 'U-open', kind: 'text', text: 'Chào', idempotencyKey: 'k2' });
    expect(r.externalMessageId).toMatch(/^m_mock_/);
    expect(outbox).toHaveLength(1);
  });
});
