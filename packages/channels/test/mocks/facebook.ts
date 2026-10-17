// Webhook payload builders for Facebook (SPEC §12 mocks): used by tests, the demo simulator and e2e.
// Shapes follow https://developers.facebook.com/docs/messenger-platform/webhooks and Lead Ads docs.
import { signFacebookPayload } from '../../src/facebook';

let seq = 0;
const nextMid = () => `m_mock_${Date.now().toString(36)}_${++seq}`;

export interface MockInbound {
  pageId: string;
  psid: string;
  text?: string;
  attachments?: { type: 'image' | 'file' | 'audio' | 'video'; url: string }[];
  stickerId?: number;
  mid?: string;
  timestamp?: number;
}

export function messengerMessagePayload(m: MockInbound) {
  const timestamp = m.timestamp ?? Date.now();
  const attachments = [
    ...(m.attachments ?? []).map((a) => ({ type: a.type, payload: { url: a.url } })),
    ...(m.stickerId ? [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/sticker.png', sticker_id: m.stickerId } }] : []),
  ];
  return {
    object: 'page',
    entry: [
      {
        id: m.pageId,
        time: timestamp,
        messaging: [
          {
            sender: { id: m.psid },
            recipient: { id: m.pageId },
            timestamp,
            message: { mid: m.mid ?? nextMid(), ...(m.text !== undefined ? { text: m.text } : {}), ...(attachments.length ? { attachments } : {}) },
          },
        ],
      },
    ],
  };
}

export function messengerEchoPayload(m: { pageId: string; psid: string; text: string; mid?: string; timestamp?: number }) {
  const timestamp = m.timestamp ?? Date.now();
  return {
    object: 'page',
    entry: [{ id: m.pageId, time: timestamp, messaging: [{ sender: { id: m.pageId }, recipient: { id: m.psid }, timestamp, message: { mid: m.mid ?? nextMid(), is_echo: true, app_id: 1, text: m.text } }] }],
  };
}

export function leadgenPayload(m: { pageId: string; leadgenId: string; formId?: string }) {
  const t = Math.floor(Date.now() / 1000);
  return {
    object: 'page',
    entry: [{ id: m.pageId, time: t, changes: [{ field: 'leadgen', value: { leadgen_id: m.leadgenId, page_id: m.pageId, form_id: m.formId ?? 'mock-form', created_time: t } }] }],
  };
}

/** Raw body + X-Hub-Signature-256 header exactly as Meta would send them. */
export function signedRequest(payload: unknown, appSecret: string) {
  const body = JSON.stringify(payload);
  return { body, signature: signFacebookPayload(body, appSecret) };
}
