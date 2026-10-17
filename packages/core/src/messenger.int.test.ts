// M3 Definition of Done: tin nhắn Page → lead tự chia; sales trả lời từ web. Plus SPEC 6.2 AC
// (webhook twice → 1 Message, 1 Lead), Lead Ads, messaging window, notes, failures.
import { createFacebookMockClient, FacebookApiError, type FacebookClient } from '@michio/channels';
import { leadgenPayload, messengerEchoPayload, messengerMessagePayload } from '@michio/channels/mocks/facebook';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, type TestOrg, testDb, vn } from '../test/fixtures';
import { acceptLead } from './assignment';
import { RecordingEffects } from './context';
import { addConversationNote, connectFacebookPage, getConversation, listConversations, renderQuickReply } from './inbox';
import { checkFacebookTokens, deliverOutboundMessage, ingestFacebookWebhook, type MessengerRuntime, processFacebookEvent, queueConversationMessages } from './messenger';
import { setSetting } from './settings';

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
const db = testDb();
afterAll(() => db.$disconnect());

let clock = vn('2026-10-15T09:00:00'); // Thursday, working hours
const sent: { psid: string; text?: string; kind: string }[] = [];
const mockClient = createFacebookMockClient({ push: async (m) => void sent.push(m) });
const rt = (client: FacebookClient = mockClient): MessengerRuntime => ({ db, effects: new RecordingEffects(), now: () => clock, client, appId: 'our-app' });

let pageSeq = 0;
async function setup() {
  const org = await createTestOrg();
  const pageId = `page-${++pageSeq}-${Date.now()}`;
  const account = await connectFacebookPage(org.ctx({ actor: org.owner }), { pageId, name: 'Facebook Michio', pageToken: 'secret-token' });
  return { org, pageId, account };
}

/** Webhook body in → stored events → processed (what the route + channel-inbound worker do). */
async function deliver(payload: unknown, r = rt()) {
  const ing = await ingestFacebookWebhook(db, payload);
  const results = [];
  for (const id of ing.eventIds) results.push(await processFacebookEvent(r, id));
  return { ...ing, results };
}

describe('Messenger inbound → lead (M3 DoD)', () => {
  let org: TestOrg;
  let pageId: string;
  beforeAll(async () => {
    ({ org, pageId } = await setup());
  });

  it('stores credentials encrypted', async () => {
    const a = await db.channelAccount.findFirstOrThrow({ where: { orgId: org.orgId, type: 'FACEBOOK_PAGE' } });
    expect(Buffer.from(a.credentials!).toString('utf8')).not.toContain('secret-token');
    expect(await db.auditLog.count({ where: { entityId: a.id, action: 'integration.facebook.connect' } })).toBe(1);
  });

  it('a first message creates a customer, a conversation and an auto-assigned lead; a retried webhook changes nothing', async () => {
    const payload = messengerMessagePayload({ pageId, psid: 'psid-A', text: 'Shop ơi cho mình xin giá sỉ matcha', mid: 'mid-A1', timestamp: clock.getTime() });
    const first = await deliver(payload);
    expect(first.eventIds).toHaveLength(1);
    const again = await deliver(payload);
    expect(again).toMatchObject({ eventIds: [], duplicates: 1 });

    const ident = await db.customerIdentity.findFirstOrThrow({ where: { externalUserId: 'psid-A' }, include: { customer: true } });
    expect(ident.customer.contactName).toBe('Khách Facebook id-A'); // mock profile: last 4 chars of the PSID
    const leads = await db.lead.findMany({ where: { customerId: ident.customerId } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source: 'FACEBOOK_MESSENGER', status: 'ASSIGNED', need: 'Shop ơi cho mình xin giá sỉ matcha' });
    expect(org.sales.map((s) => s.id)).toContain(leads[0]!.ownerId);
    const conv = await db.conversation.findFirstOrThrow({ where: { externalThreadId: 'psid-A' }, include: { messages: true } });
    expect(conv).toMatchObject({ leadId: leads[0]!.id, unreadCount: 1 });
    expect(conv.messages).toHaveLength(1);
    expect(conv.lastInboundAt?.getTime()).toBe(clock.getTime());
  });

  it('a follow-up message joins the open lead and tells its owner at most once per 5 minutes', async () => {
    await deliver(messengerMessagePayload({ pageId, psid: 'psid-A', text: 'Mình ở Hải Phòng', mid: 'mid-A2', timestamp: clock.getTime() + 1000 }));
    await deliver(messengerMessagePayload({ pageId, psid: 'psid-A', attachments: [{ type: 'image', url: 'https://cdn/x.jpg' }], mid: 'mid-A3', timestamp: clock.getTime() + 2000 }));
    const lead = await db.lead.findFirstOrThrow({ where: { customer: { identities: { some: { externalUserId: 'psid-A' } } } } });
    expect(await db.lead.count({ where: { customerId: lead.customerId } })).toBe(1);
    const conv = await db.conversation.findFirstOrThrow({ where: { externalThreadId: 'psid-A' }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    expect(conv.unreadCount).toBe(3);
    expect(conv.messages.map((m) => m.kind)).toEqual(['text', 'text', 'image']);
    expect(await db.notification.count({ where: { userId: lead.ownerId!, type: 'lead.recontact' } })).toBe(1);
    // Timeline: one summarized MESSAGE_IN entry, not one per message.
    const acts = await db.activity.findMany({ where: { customerId: lead.customerId, type: 'MESSAGE_IN' } });
    expect(acts).toHaveLength(1);
    expect(acts[0]!.data).toMatchObject({ count: 3, preview: 'Shop ơi cho mình xin giá sỉ matcha' });
  });

  it('the owner replies from the web: queued → sent through the gateway, counts as first contact', async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { customer: { identities: { some: { externalUserId: 'psid-A' } } } } });
    const owner = org.sales.find((s) => s.id === lead.ownerId)!;
    await acceptLead(org.ctx({ actor: owner, now: () => clock }), lead.id);
    const conv = await db.conversation.findFirstOrThrow({ where: { externalThreadId: 'psid-A' } });

    // Another salesperson cannot see or reply.
    const other = org.sales.find((s) => s.id !== owner.id)!;
    await expect(queueConversationMessages(org.ctx({ actor: other, now: () => clock }), conv.id, [{ text: 'Chào' }])).rejects.toThrow('Không tìm thấy hội thoại');
    await expect(getConversation(org.ctx({ actor: other, now: () => clock }), conv.id)).rejects.toThrow();

    const ctx = org.ctx({ actor: owner, now: () => clock });
    const { messages } = await queueConversationMessages(ctx, conv.id, [{ text: 'Dạ em chào chị ạ', idempotencyKey: 'k-1' }]);
    expect(messages[0]).toMatchObject({ status: 'QUEUED', direction: 'OUT', sentByUserId: owner.id });
    expect(ctx.effects.outbound).toEqual([messages[0]!.id]);
    // Double click with the same key → same message.
    const again = await queueConversationMessages(ctx, conv.id, [{ text: 'Dạ em chào chị ạ', idempotencyKey: 'k-1' }]);
    expect(again.messages[0]!.id).toBe(messages[0]!.id);

    clock = new Date(clock.getTime() + 4 * 60_000);
    expect(await deliverOutboundMessage(rt(), messages[0]!.id, { finalAttempt: false })).toEqual({ status: 'SENT' });
    expect(sent.at(-1)).toMatchObject({ psid: 'psid-A', text: 'Dạ em chào chị ạ', kind: 'text' });
    const m = await db.message.findUniqueOrThrow({ where: { id: messages[0]!.id } });
    expect(m.status).toBe('SENT');
    expect(m.externalMessageId).toMatch(/^m_mock_/);
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.firstContactAt?.getTime()).toBe(clock.getTime());
    expect(await db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ unreadCount: 0 });
    // Re-running the job does not send twice.
    expect(await deliverOutboundMessage(rt(), messages[0]!.id, { finalAttempt: false })).toEqual({ status: 'SKIPPED' });

    // Echo of our own send is ignored; a reply typed in Facebook's Page inbox is kept.
    await deliver({ ...messengerEchoPayload({ pageId, psid: 'psid-A', text: 'Dạ em chào chị ạ', mid: m.externalMessageId! }), entry: [{ id: pageId, messaging: [{ sender: { id: pageId }, recipient: { id: 'psid-A' }, timestamp: clock.getTime(), message: { mid: 'x-own', is_echo: true, app_id: 'our-app', text: 'Dạ' } }] }] });
    await deliver(messengerEchoPayload({ pageId, psid: 'psid-A', text: 'Trả lời từ Page inbox', mid: 'mid-echo-1' }));
    await deliver(messengerEchoPayload({ pageId, psid: 'psid-A', text: 'Trả lời từ Page inbox', mid: 'mid-echo-1' }));
    expect(await db.message.count({ where: { conversationId: conv.id, direction: 'OUT' } })).toBe(2);
  });

  it('locks sending after the 24 h window; HUMAN_AGENT tag extends it to 7 days when enabled', async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { customer: { identities: { some: { externalUserId: 'psid-A' } } } } });
    const owner = org.sales.find((s) => s.id === lead.ownerId)!;
    const conv = await db.conversation.findFirstOrThrow({ where: { externalThreadId: 'psid-A' } });
    clock = new Date(clock.getTime() + 25 * 3600_000);
    const ctx = org.ctx({ actor: owner, now: () => clock });
    const view = await getConversation(ctx, conv.id);
    expect(view.window.ok).toBe(false);
    await expect(queueConversationMessages(ctx, conv.id, [{ text: 'Chị ơi' }])).rejects.toThrow('24 giờ');

    await setSetting(db, org.orgId, 'facebook.useHumanAgentTag', true);
    const { messages } = await queueConversationMessages(ctx, conv.id, [{ text: 'Chị ơi em gửi lại báo giá' }]);
    expect(await deliverOutboundMessage(rt(), messages[0]!.id, { finalAttempt: false })).toEqual({ status: 'SENT' });
    await setSetting(db, org.orgId, 'facebook.useHumanAgentTag', false);
  });

  it('internal notes are not sent and @mention a colleague', async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { customer: { identities: { some: { externalUserId: 'psid-A' } } } } });
    const owner = org.sales.find((s) => s.id === lead.ownerId)!;
    const conv = await db.conversation.findFirstOrThrow({ where: { externalThreadId: 'psid-A' } });
    const ctx = org.ctx({ actor: owner, now: () => clock });
    const note = await addConversationNote(ctx, conv.id, { text: 'Khách hỏi chiết khấu, nhờ @MANAGER 1 duyệt' });
    expect(note.direction).toBe('NOTE');
    expect(ctx.effects.outbound).toHaveLength(0);
    expect(await db.notification.count({ where: { userId: org.manager.id, type: 'conversation.mention' } })).toBe(1);
  });

  it('lists conversations by view with scope', async () => {
    await deliver(messengerMessagePayload({ pageId, psid: 'psid-B', text: 'Có sỉ bánh kẹo không ạ', mid: 'mid-B1', timestamp: clock.getTime() }));
    const managerCtx = org.ctx({ actor: org.manager, now: () => clock });
    const all = await listConversations(managerCtx, {});
    expect(all.items.map((c) => c.externalThreadId).sort()).toEqual(['psid-A', 'psid-B']);
    const unanswered = await listConversations(managerCtx, { view: 'unanswered' });
    expect(unanswered.items.map((c) => c.externalThreadId)).toEqual(['psid-B']);
    const leadB = await db.lead.findFirstOrThrow({ where: { customer: { identities: { some: { externalUserId: 'psid-B' } } } } });
    const ownerB = org.sales.find((s) => s.id === leadB.ownerId)!;
    const mine = await listConversations(org.ctx({ actor: ownerB, now: () => clock }), {});
    expect(mine.items.map((c) => c.externalThreadId)).toContain('psid-B');
    const leadA = await db.lead.findFirstOrThrow({ where: { customer: { identities: { some: { externalUserId: 'psid-A' } } } } });
    if (leadA.ownerId !== ownerB.id) expect(mine.items.map((c) => c.externalThreadId)).not.toContain('psid-A');
  });
});

describe('Lead Ads', () => {
  it('fetches the lead by leadgen_id and creates a FACEBOOK_LEAD_ADS lead once', async () => {
    const { org, pageId } = await setup();
    const client = createFacebookMockClient({ push: async () => {} }, {
      'LG-1': { id: 'LG-1', createdTime: null, formId: 'F9', adId: null, fields: { full_name: 'Trần Thị Lan', phone_number: '0912 000 111', city: 'Nam Định', 'Mô hình kinh doanh': 'Minimart', 'Mức nhập dự kiến': '30–50 triệu' } },
    });
    const payload = leadgenPayload({ pageId, leadgenId: 'LG-1', formId: 'F9' });
    await deliver(payload, rt(client));
    await deliver(payload, rt(client));
    const leads = await db.lead.findMany({ where: { orgId: org.orgId, source: 'FACEBOOK_LEAD_ADS' }, include: { customer: true } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ priority: 'HOT', status: 'ASSIGNED', campaign: 'leadads-form-F9' });
    expect(leads[0]!.customer).toMatchObject({ contactName: 'Trần Thị Lan', phone: '+84912000111', province: 'Nam Định', businessModel: 'MINIMART', expectedOrderBand: 'B30_50M' });
  });
});

describe('Outbound failures & token health', () => {
  it('retryable errors rethrow until the last attempt; token errors mark the Page ERROR and alert managers', async () => {
    const { org, pageId } = await setup();
    await deliver(messengerMessagePayload({ pageId, psid: 'psid-F', text: 'Hi', mid: 'mid-F1', timestamp: clock.getTime() }));
    const lead = await db.lead.findFirstOrThrow({ where: { orgId: org.orgId } });
    const owner = org.sales.find((s) => s.id === lead.ownerId)!;
    await acceptLead(org.ctx({ actor: owner, now: () => clock }), lead.id);
    const conv = await db.conversation.findFirstOrThrow({ where: { orgId: org.orgId } });
    const ctx = org.ctx({ actor: owner, now: () => clock });

    const flaky: FacebookClient = { ...mockClient, send: async () => Promise.reject(new FacebookApiError('messages', 500, 2, 'Service temporarily unavailable')) };
    const { messages: [m1] } = await queueConversationMessages(ctx, conv.id, [{ text: 'Lần 1' }]);
    await expect(deliverOutboundMessage(rt(flaky), m1!.id, { finalAttempt: false })).rejects.toThrow('temporarily');
    expect(await deliverOutboundMessage(rt(flaky), m1!.id, { finalAttempt: true })).toMatchObject({ status: 'FAILED' });
    expect(await db.notification.count({ where: { userId: owner.id, type: 'message.failed' } })).toBe(1);

    const expired: FacebookClient = { ...mockClient, send: async () => Promise.reject(new FacebookApiError('messages', 400, 190, 'Error validating access token')) };
    const { messages: [m2] } = await queueConversationMessages(ctx, conv.id, [{ text: 'Lần 2' }]);
    expect(await deliverOutboundMessage(rt(expired), m2!.id, { finalAttempt: false })).toMatchObject({ status: 'FAILED' });
    const page = await db.channelAccount.findFirstOrThrow({ where: { orgId: org.orgId, type: 'FACEBOOK_PAGE' } });
    expect(page.status).toBe('ERROR');
    expect(await db.notification.count({ where: { userId: org.owner.id, type: 'system' } })).toBe(1);
    // Composer is locked while the channel is broken.
    await expect(queueConversationMessages(ctx, conv.id, [{ text: 'Lần 3' }])).rejects.toThrow('Kết nối Facebook');

    // Daily token check: a working token brings it back.
    await checkFacebookTokens(rt(), org.orgId);
    expect((await db.channelAccount.findUniqueOrThrow({ where: { id: page.id } })).status).toBe('ACTIVE');
    const broken: FacebookClient = { ...mockClient, checkPageToken: async () => ({ ok: false, error: 'expired' }) };
    await checkFacebookTokens(rt(broken), org.orgId);
    expect((await db.channelAccount.findUniqueOrThrow({ where: { id: page.id } })).status).toBe('ERROR');
  });
});

describe('quick replies', () => {
  it('renders {ten_khach}, {ten_sales}, {sdt_sales}', () => {
    expect(renderQuickReply('Chào {ten_khach}, em là {ten_sales} ({sdt_sales}) {khac}', { customerName: 'chị Hoa', salesName: 'Hạnh', salesPhone: '+84904000011' })).toBe(
      'Chào chị Hoa, em là Hạnh (0904000011) {khac}',
    );
  });
});
