// M2 Definition of Done: người trực Zalo công ty tạo lead bằng `LEAD …`, sales nhận / trả / hẹn
// hoàn toàn qua Zalo; thông báo + nhắc việc + tổng kết sáng đi qua bot.
import type { ZaloBotUpdate } from '@michio/channels';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, nextPhone, type TestOrg, testDb, vn } from '../test/fixtures';
import { createBotLinkCode, updateNotificationPrefs } from './bot-account';
import { formatBotMessage, markBotDelivered, prepareBotDelivery } from './bot-delivery';
import { createDailyDigests, warnExpiringAssignments } from './bot-jobs';
import { type BotRuntime, handleBotUpdate } from './bot';
import { RecordingEffects } from './context';
import { remindDueTasks } from './tasks';

const db = testDb();
afterAll(() => db.$disconnect());

const msg = (chatId: string, text: string): ZaloBotUpdate => ({
  eventName: 'message.text.received', messageId: `m-${Math.random()}`, chatId, chatType: 'PRIVATE', fromId: chatId, displayName: null, text, date: null,
});

let clock = vn('2026-10-15T09:00:00'); // Thursday, working hours
const rt: BotRuntime = { db, effects: new RecordingEffects(), now: () => clock };
const say = async (chatId: string, text: string) => (await handleBotUpdate(rt, msg(chatId, text))).join('\n');

async function link(org: TestOrg, user: TestOrg['sales'][number], chatId: string) {
  const { code } = await createBotLinkCode(org.ctx({ actor: user, now: () => clock }));
  return say(chatId, code);
}

describe('Zalo Bot — account linking', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg();
  });

  it('unknown chat gets instructions; a valid 6-digit code links it once', async () => {
    expect(await say('chat-x', 'NHAN 1001')).toContain('Kết nối Zalo Bot');
    const reply = await link(org, org.sales[0]!, 'chat-s1');
    expect(reply).toContain('Đã kết nối Zalo');
    expect((await db.user.findUniqueOrThrow({ where: { id: org.sales[0]!.id } })).zaloBotChatId).toBe('chat-s1');
    expect(await db.auditLog.count({ where: { entityId: org.sales[0]!.id, action: 'user.zaloBot.link', via: 'ZALO_BOT' } })).toBe(1);
  });

  it('expired or reused codes are rejected', async () => {
    const { code } = await createBotLinkCode(org.ctx({ actor: org.sales[1]!, now: () => clock }));
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect(await say('chat-s2', code)).toContain('hết hạn');
    clock = vn('2026-10-15T09:00:00');
    expect(await say('chat-s2', '000000')).toContain('Mã không đúng');
  });
});

describe('Zalo Bot — M2 DoD: LEAD by the Zalo duty person, NHAN / TRA / HEN / GOI / XONG by sales', () => {
  let org: TestOrg;
  const chat = (i: number) => `dod-chat-${i}`;
  beforeAll(async () => {
    org = await createTestOrg();
    await link(org, org.owner, 'dod-owner');
    for (const [i, s] of org.sales.entries()) await link(org, s, chat(i));
    await db.pipelineStage.createMany({
      data: [
        { orgId: org.orgId, code: 'TU_VAN', name: 'Tư vấn nhóm hàng', order: 3, probability: 40 },
        { orgId: org.orgId, code: 'BAO_GIA', name: 'Đã gửi báo giá/chính sách', order: 4, probability: 60 },
        { orgId: org.orgId, code: 'CHOT', name: 'Chốt đơn', order: 5, probability: 100, isWon: true },
        { orgId: org.orgId, code: 'THUA', name: 'Không thành công', order: 6, probability: 0, isLost: true },
      ],
    });
    await db.lostReason.createMany({ data: [{ orgId: org.orgId, name: 'Giá cao hơn nguồn khác' }, { orgId: org.orgId, name: 'Khác' }] });
  });

  it('LEAD creates a ZALO_COMPANY lead and rotates it; assignee is notified', async () => {
    const phone = nextPhone();
    const reply = await say('dod-owner', `LEAD ${phone} Chị Hoa - shop mẹ bé Hải Phòng - quan tâm matcha`);
    expect(reply).toMatch(/✅ Đã tạo lead #\d+ · Chị Hoa → SALES 1/);
    const lead = await db.lead.findFirstOrThrow({ where: { orgId: org.orgId, customer: { contactName: 'Chị Hoa' } } });
    expect(lead).toMatchObject({ source: 'ZALO_COMPANY', ownerId: org.sales[0]!.id, status: 'ASSIGNED', need: 'Chị Hoa - shop mẹ bé Hải Phòng - quan tâm matcha' });
    const n = await db.notification.findFirstOrThrow({ where: { userId: org.sales[0]!.id, type: 'lead.assigned' } });
    expect(n.body).toContain(`NHAN ${lead.code} / TRA ${lead.code}`);
    expect(await db.auditLog.count({ where: { entityId: lead.id, action: 'lead.create', via: 'ZALO_BOT' } })).toBe(1);
    // same phone again → duplicate, no second lead
    expect(await say('dod-owner', `LEAD ${phone} Chị Hoa`)).toContain(`đã có lead đang mở #${lead.code}`);
  });

  it('NHAN → accepted with full phone; GOI → first contact; HEN → task with code; XONG → done', async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { orgId: org.orgId, customer: { contactName: 'Chị Hoa' } } });
    expect(await say(chat(1), `NHAN ${lead.code}`)).toContain(`Không tìm thấy lead #${lead.code}`); // not theirs
    const accepted = await say(chat(0), `nhận ${lead.code}`);
    expect(accepted).toContain(`✅ Đã nhận lead #${lead.code}`);
    expect(accepted).toMatch(/📞 0\d{9}/);

    expect(await say(chat(0), `GOI ${lead.code} đã gửi bảng giá`)).toContain('liên hệ đầu tiên');
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).firstContactAt).not.toBeNull();

    const hen = await say(chat(0), `HEN ${lead.code} mai 15:00 gọi lại chốt matcha`);
    expect(hen).toContain('📌 Đã hẹn 16/10/2026 15:00');
    const task = await db.task.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(task).toMatchObject({ type: 'CALL', assigneeId: org.sales[0]!.id, title: 'gọi lại chốt matcha', dueAt: vn('2026-10-16T15:00:00') });

    expect(await say(chat(0), 'HOMNAY')).toContain('Hôm nay của SALES 1');
    expect(await say(chat(1), `XONG ${task.code}`)).toContain('Không tìm thấy việc'); // someone else's task
    expect(await say(chat(0), `XONG ${task.code}`)).toContain(`☑️ Đã xong việc V${task.code}`);
    expect(await say(chat(0), `XONG ${task.code}`)).toContain('đã hoàn thành trước đó');
  });

  it('TRANGTHAI moves the deal; THUA picks the lost reason from free text', async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { orgId: org.orgId, customer: { contactName: 'Chị Hoa' } } });
    expect(await say(chat(0), `TRANGTHAI ${lead.code} BAOGIA`)).toContain('Đã gửi báo giá/chính sách');
    expect(await say(chat(0), `trạng thái ${lead.code} thua giá cao`)).toContain('lý do: Giá cao hơn nguồn khác');
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('LOST');
    expect(await db.deal.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it('TRA hands the lead to the next sales; NGHI / LAMVIEC toggle receiving leads', async () => {
    const r = await say('dod-owner', `LEAD ${nextPhone()} Anh Tùng`);
    const code = Number(r.match(/#(\d+)/)![1]);
    const lead = await db.lead.findFirstOrThrow({ where: { orgId: org.orgId, code } });
    const holder = org.sales.findIndex((s) => s.id === lead.ownerId);
    expect(await say(chat(holder), `TRA ${code} không đúng khu vực`)).toContain('↩️ Đã trả lead');
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.ownerId).not.toBe(org.sales[holder]!.id);

    expect(await say(chat(2), 'NGHI')).toContain('tạm dừng');
    expect((await db.user.findUniqueOrThrow({ where: { id: org.sales[2]!.id } })).status).toBe('BUSY');
    expect(await say(chat(2), 'lam viec')).toContain('Đã bật nhận lead');
    expect(await db.auditLog.count({ where: { entityId: org.sales[2]!.id, action: 'user.status', via: 'ZALO_BOT' } })).toBe(2);
  });

  it('permissions are the web permissions: SUPPORT cannot create leads', async () => {
    const support = await db.user.create({ data: { orgId: org.orgId, email: `kt-${Date.now()}@test.local`, fullName: 'Kế toán', role: 'SUPPORT', passwordHash: 'x' } });
    await link(org, { id: support.id, orgId: org.orgId, role: 'SUPPORT', status: 'AVAILABLE', deletedAt: null, email: support.email }, 'dod-support');
    expect(await say('dod-support', `LEAD ${nextPhone()} Khách`)).toContain('không có quyền');
    expect(await say('dod-support', 'xin chào')).toContain('HELP');
  });
});

describe('Zalo delivery rules', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg();
    await link(org, org.sales[0]!, 'dl-0');
  });
  const notify = (type: string, extra: Record<string, unknown> = {}) =>
    db.notification.create({ data: { userId: org.sales[0]!.id, type, title: `🔔 ${type}`, body: 'Nội dung', link: '/leads/x', ...extra } });

  it('sends in working hours with a deep link', async () => {
    const n = await notify('lead.assigned');
    const d = await prepareBotDelivery(db, n.id, vn('2026-10-15T10:00:00'), { appUrl: 'https://sales.michio.vn/' });
    expect(d).toEqual({ action: 'send', chatId: 'dl-0', text: '🔔 lead.assigned\nNội dung\n👉 https://sales.michio.vn/leads/x' });
    await markBotDelivered(db, n.id, new Date());
    expect(await prepareBotDelivery(db, n.id, new Date())).toEqual({ action: 'skip', reason: 'already-sent' });
  });

  it('outside hours waits for the next opening (Saturday night → Monday 08:00), urgent ones go now', async () => {
    const n = await notify('lead.assigned');
    expect(await prepareBotDelivery(db, n.id, vn('2026-10-17T20:00:00'))).toEqual({ action: 'delay', until: vn('2026-10-19T08:00:00') });
    const q = await notify('lead.queued');
    expect((await prepareBotDelivery(db, q.id, vn('2026-10-17T20:00:00'))).action).toBe('send');
  });

  it('respects preferences, but "được giao lead" cannot be muted', async () => {
    await updateNotificationPrefs(org.ctx({ actor: org.sales[0]! }), { zalo: { 'task.due': false, 'lead.assigned': false } });
    expect(await prepareBotDelivery(db, (await notify('task.due')).id, vn('2026-10-15T10:00:00'))).toEqual({ action: 'skip', reason: 'muted' });
    expect((await prepareBotDelivery(db, (await notify('lead.assigned')).id, vn('2026-10-15T10:00:00'))).action).toBe('send');
  });

  it('throttles "khách liên hệ lại" to one per lead per 5 minutes; drops stale expiry warnings', async () => {
    const t = vn('2026-10-15T10:00:00');
    await notify('lead.recontact', { link: '/leads/r1', sentZaloAt: new Date(t.getTime() - 60_000) });
    expect(await prepareBotDelivery(db, (await notify('lead.recontact', { link: '/leads/r1' })).id, t)).toEqual({ action: 'skip', reason: 'throttled' });
    expect((await prepareBotDelivery(db, (await notify('lead.recontact', { link: '/leads/r2' })).id, t)).action).toBe('send');
    const old = await notify('lead.expiring', { createdAt: new Date(t.getTime() - 20 * 60_000) });
    expect(await prepareBotDelivery(db, old.id, t)).toEqual({ action: 'skip', reason: 'stale' });
  });

  it('users without a linked chat are skipped', async () => {
    const n = await db.notification.create({ data: { userId: org.sales[1]!.id, type: 'lead.assigned', title: 't', body: 'b' } });
    expect(await prepareBotDelivery(db, n.id, new Date())).toEqual({ action: 'skip', reason: 'not-linked' });
    expect(formatBotMessage({ title: 'A', body: '', link: null })).toBe('A');
  });
});

describe('scheduled bot notifications', () => {
  it('"còn 3 phút" warning once per assignment; task reminder once; queued for Zalo delivery', async () => {
    const org = await createTestOrg();
    const ctx = org.ctx({ now: vn('2026-10-15T09:00:00') });
    const customer = await db.customer.create({ data: { orgId: org.orgId, contactName: 'K' } });
    const lead = await db.lead.create({ data: { orgId: org.orgId, code: 900_000 + Math.floor(Math.random() * 99_999), source: 'MANUAL', status: 'ASSIGNED', ownerId: org.sales[0]!.id, customerId: customer.id } });
    await db.leadAssignment.create({ data: { leadId: lead.id, userId: org.sales[0]!.id, method: 'ROUND_ROBIN', acceptDeadline: vn('2026-10-15T09:02:30') } });
    expect(await warnExpiringAssignments(ctx)).toEqual({ warned: 1 });
    expect(await warnExpiringAssignments(ctx)).toEqual({ warned: 0 });
    const w = await db.notification.findFirstOrThrow({ where: { userId: org.sales[0]!.id, type: 'lead.expiring' } });
    expect(w.title).toBe(`⏰ Còn 3 phút để nhận lead #${lead.code} → NHAN ${lead.code}`);
    expect(ctx.effects.deliveries).toContain(w.id);

    await db.task.create({ data: { orgId: org.orgId, title: 'Gọi lại', type: 'CALL', dueAt: vn('2026-10-15T09:10:00'), assigneeId: org.sales[1]!.id, leadId: lead.id, customerId: customer.id } });
    expect(await remindDueTasks(ctx)).toEqual({ reminded: 1 });
    expect(await remindDueTasks(ctx)).toEqual({ reminded: 0 });
    const r = await db.notification.findFirstOrThrow({ where: { userId: org.sales[1]!.id, type: 'task.due' } });
    expect(r.title).toMatch(/^📌 09:10 K \(#\d+\): Gọi lại — việc V\d+$/);
  });

  it('08:00 digest: linked sales and managers, once per day, never on holidays', async () => {
    const org = await createTestOrg({ holidays: ['2026-10-20'] });
    await link(org, org.sales[0]!, `dg-s-${org.orgId}`);
    await link(org, org.owner, `dg-o-${org.orgId}`);
    const ctx = org.ctx({ now: vn('2026-10-15T08:00:00') });
    expect(await createDailyDigests(ctx)).toEqual({ created: 2 });
    expect(await createDailyDigests(ctx)).toEqual({ created: 0 });
    const s = await db.notification.findFirstOrThrow({ where: { userId: org.sales[0]!.id, type: 'daily.digest' } });
    expect(s.title).toBe('☀️ Chào SALES 1, tổng kết sáng 15/10/2026:');
    expect(s.body).toContain('Lead chờ nhận: 0');
    const o = await db.notification.findFirstOrThrow({ where: { userId: org.owner.id, type: 'daily.digest' } });
    expect(o.body).toContain('Doanh số tháng');
    expect(await createDailyDigests(org.ctx({ now: vn('2026-10-20T08:00:00') }))).toMatchObject({ created: 0, skipped: 'holiday' });
  });
});

describe('inbound events', () => {
  it('a webhook delivered twice runs the command once and replies once', async () => {
    const { ingestZaloBotPayload, processZaloBotEvent } = await import('./bot-inbound');
    const payload = { ok: true, result: { event_name: 'message.text.received', message: { chat: { id: 'dup-chat' }, from: { id: 'dup-chat' }, text: 'HELP', message_id: `dup-${Date.now()}` } } };
    const first = await ingestZaloBotPayload(db, payload);
    const second = await ingestZaloBotPayload(db, payload);
    expect(first?.duplicate).toBe(false);
    expect(second).toEqual({ eventId: first!.eventId, duplicate: true });
    const sent: string[] = [];
    await processZaloBotEvent(rt, first!.eventId, async (_c, t) => void sent.push(t));
    await processZaloBotEvent(rt, first!.eventId, async (_c, t) => void sent.push(t));
    expect(sent).toHaveLength(1);
    expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: first!.eventId } })).status).toBe('PROCESSED');
  });
});
