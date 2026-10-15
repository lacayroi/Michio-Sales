// Integration tests for lead intake + assignment against a real PostgreSQL (SPEC 6.2, 6.3, §12).
import { describe, expect, it } from 'vitest';
import { createTestOrg, nextPhone, testDb, vn } from '../test/fixtures';
import { acceptLead, assignLead, manualAssign, releaseHeldLeads, returnLead, sweepSla } from './assignment';
import { addLeadActivity, intakeLead } from './leads';
import { setSetting } from './settings';

const lead = (over: Record<string, unknown> = {}) => ({ source: 'WEBSITE_WHOLESALE_FORM' as const, fullName: 'Khách thử', phone: nextPhone(), ...over });

describe('AC 6.3 — bắt buộc', () => {
  it('90 lead tạo song song → mỗi sales nhận 30 (± 1)', async () => {
    const org = await createTestOrg();
    const ctx = org.ctx();
    const results = await Promise.all(Array.from({ length: 90 }, () => intakeLead(ctx, lead())));

    expect(results.every((r) => r.assignment?.status === 'ASSIGNED')).toBe(true);
    const db = testDb();
    const counts = await db.lead.groupBy({ by: ['ownerId'], where: { orgId: org.orgId }, _count: true });
    expect(counts).toHaveLength(3);
    for (const c of counts) {
      expect(org.sales.map((s) => s.id)).toContain(c.ownerId);
      expect(Math.abs(c._count - 30)).toBeLessThanOrEqual(1);
    }
    // One PENDING assignment per lead, unique lead codes.
    expect(await db.leadAssignment.count({ where: { lead: { orgId: org.orgId }, status: 'PENDING' } })).toBe(90);
    expect(new Set(results.map((r) => r.code)).size).toBe(90);
  });

  it('lead vào lúc 20:00 thứ Bảy có hạn nhận 08:10 thứ Hai', async () => {
    const org = await createTestOrg();
    const ctx = org.ctx({ now: vn('2026-10-17T20:00:00') }); // thứ Bảy
    const r = await intakeLead(ctx, lead({ expectedOrderBand: 'B5_10M' })); // WARM → 10 phút

    expect(r.assignment).toMatchObject({ status: 'ASSIGNED' });
    const a = await testDb().leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId } });
    expect(a.status).toBe('PENDING');
    expect(a.acceptDeadline).toEqual(vn('2026-10-19T08:10:00')); // thứ Hai
    // The SLA check is scheduled exactly at the deadline.
    expect(ctx.effects.slaChecks).toEqual([{ assignmentId: a.id, at: vn('2026-10-19T08:10:00') }]);
  });
});

describe('assignment engine', () => {
  it('HOT leads get the 5-minute accept SLA', async () => {
    const org = await createTestOrg();
    const r = await intakeLead(org.ctx(), lead({ expectedOrderBand: 'GT_50M' }));
    const l = await testDb().lead.findUniqueOrThrow({ where: { id: r.leadId }, include: { assignments: true } });
    expect(l.priority).toBe('HOT');
    expect(l.assignments[0]?.acceptDeadline).toEqual(vn('2026-10-15T09:05:00'));
  });

  it('skips sales who are OFF; rotation continues with the next person', async () => {
    const org = await createTestOrg();
    const db = testDb();
    await db.user.update({ where: { id: org.sales[1]!.id }, data: { status: 'OFF' } });
    const ctx = org.ctx();
    const owners = [];
    for (let i = 0; i < 4; i++) owners.push((await intakeLead(ctx, lead())).assignment);
    const ids = owners.map((o) => (o?.status === 'ASSIGNED' ? o.userId : null));
    expect(ids).toEqual([org.sales[0]!.id, org.sales[2]!.id, org.sales[0]!.id, org.sales[2]!.id]);
  });

  it('skips sales on leave or at maxOpenLeads', async () => {
    const org = await createTestOrg();
    const db = testDb();
    await db.userLeave.create({ data: { userId: org.sales[0]!.id, startAt: vn('2026-10-14T00:00:00'), endAt: vn('2026-10-16T00:00:00') } });
    await db.user.update({ where: { id: org.sales[1]!.id }, data: { maxOpenLeads: 0 } });
    const r = await intakeLead(org.ctx(), lead());
    expect(r.assignment).toMatchObject({ status: 'ASSIGNED', userId: org.sales[2]!.id });
  });

  it('queues and alerts managers when nobody is eligible', async () => {
    const org = await createTestOrg();
    const db = testDb();
    await db.user.updateMany({ where: { id: { in: org.sales.map((s) => s.id) } }, data: { status: 'BUSY' } });
    const r = await intakeLead(org.ctx(), lead());
    expect(r.assignment).toMatchObject({ status: 'QUEUED' });
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).status).toBe('UNASSIGNED');
    expect(await db.notification.count({ where: { userId: { in: [org.owner.id, org.manager.id] }, type: 'lead.queued' } })).toBe(2);
  });

  it('expired lead is reclaimed by the sweeper and goes to someone else; after 3 times it is queued', async () => {
    const org = await createTestOrg();
    const db = testDb();
    let now = vn('2026-10-15T09:00:00');
    const ctx = org.ctx({ now: () => now });
    const r = await intakeLead(ctx, lead());
    const first = r.assignment?.status === 'ASSIGNED' ? r.assignment.userId : '';

    // Not yet due → nothing happens.
    now = vn('2026-10-15T09:09:00');
    expect((await sweepSla(ctx)).expired).toBe(0);

    // ≤ 60 s after the deadline the sweeper reclaims it (AC 6.3).
    now = vn('2026-10-15T09:10:30');
    expect((await sweepSla(ctx)).expired).toBe(1);
    const second = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'PENDING' } });
    expect(second.userId).not.toBe(first);
    expect(await db.notification.count({ where: { userId: first, type: 'lead.reclaimed' } })).toBe(1);

    now = vn('2026-10-15T09:21:00');
    await sweepSla(ctx);
    const third = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'PENDING' } });
    expect(new Set([first, second.userId, third.userId]).size).toBe(3);

    now = vn('2026-10-15T09:32:00');
    await sweepSla(ctx);
    const l = await db.lead.findUniqueOrThrow({ where: { id: r.leadId } });
    expect(l).toMatchObject({ status: 'UNASSIGNED', ownerId: null, reassignCount: 3 });
    expect(await db.leadAssignment.count({ where: { leadId: r.leadId, status: 'EXPIRED' } })).toBe(3);
  });

  it('accept → IN_PROGRESS with first-contact deadline; a CALL records first contact', async () => {
    const org = await createTestOrg();
    const r = await intakeLead(org.ctx(), lead());
    const userId = r.assignment?.status === 'ASSIGNED' ? r.assignment.userId : '';
    const sales = org.sales.find((s) => s.id === userId)!;
    const ctx = org.ctx({ actor: sales, now: vn('2026-10-15T09:03:00') });

    const acc = await acceptLead(ctx, r.leadId);
    expect(acc.firstContactDeadline).toEqual(vn('2026-10-15T09:33:00'));
    await addLeadActivity(ctx, r.leadId, { type: 'CALL', result: 'ANSWERED', note: 'Đã tư vấn' });
    const l = await testDb().lead.findUniqueOrThrow({ where: { id: r.leadId } });
    expect(l.status).toBe('IN_PROGRESS');
    expect(l.firstContactAt).toEqual(vn('2026-10-15T09:03:00'));
    expect(await testDb().auditLog.count({ where: { entityId: r.leadId, action: { in: ['lead.accept', 'lead.first_contact'] } } })).toBe(2);
  });

  it('cannot accept after the deadline or a lead assigned to someone else', async () => {
    const org = await createTestOrg();
    const r = await intakeLead(org.ctx(), lead());
    const userId = r.assignment?.status === 'ASSIGNED' ? r.assignment.userId : '';
    const other = org.sales.find((s) => s.id !== userId)!;
    await expect(acceptLead(org.ctx({ actor: other }), r.leadId)).rejects.toThrow('không còn chờ bạn nhận');
    const me = org.sales.find((s) => s.id === userId)!;
    await expect(acceptLead(org.ctx({ actor: me, now: vn('2026-10-15T09:11:00') }), r.leadId)).rejects.toThrow('quá hạn');
  });

  it('return → re-routed to another sales, never back to the one who returned', async () => {
    const org = await createTestOrg({ salesCount: 2 });
    const r = await intakeLead(org.ctx(), lead());
    const userId = r.assignment?.status === 'ASSIGNED' ? r.assignment.userId : '';
    const me = org.sales.find((s) => s.id === userId)!;
    const out = await returnLead(org.ctx({ actor: me }), r.leadId, 'Không đúng khu vực');
    expect(out).toMatchObject({ status: 'ASSIGNED' });
    expect(out.status === 'ASSIGNED' && out.userId).not.toBe(me.id);
    const returned = await testDb().leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'RETURNED' } });
    expect(returned.returnReason).toBe('Không đúng khu vực');
  });

  it('manual assign by Owner closes the old assignment; Sales cannot assign', async () => {
    const org = await createTestOrg();
    const r = await intakeLead(org.ctx(), lead());
    const target = org.sales.find((s) => r.assignment?.status === 'ASSIGNED' && s.id !== r.assignment.userId)!;
    await expect(manualAssign(org.ctx({ actor: org.sales[0]! }), [r.leadId], target.id)).rejects.toThrow('quyền');
    const res = await manualAssign(org.ctx({ actor: org.owner }), [r.leadId], target.id);
    expect(res).toEqual([{ leadId: r.leadId, ok: true }]);
    const db = testDb();
    const list = await db.leadAssignment.findMany({ where: { leadId: r.leadId }, orderBy: { createdAt: 'asc' } });
    expect(list.map((a) => [a.status, a.method])).toEqual([['REASSIGNED', 'ROUND_ROBIN'], ['ACCEPTED', 'TRANSFER']]);
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).ownerId).toBe(target.id);
    expect(await db.auditLog.count({ where: { entityId: r.leadId, action: 'lead.assign' } })).toBe(2);
  });

  it('outOfHoursMode = HOLD keeps the lead until the 08:00 release', async () => {
    const org = await createTestOrg();
    await setSetting(testDb(), org.orgId, 'assignment.outOfHoursMode', 'HOLD');
    const r = await intakeLead(org.ctx({ now: vn('2026-10-17T21:00:00') }), lead());
    expect(r.assignment).toEqual({ status: 'HELD' });
    const released = await releaseHeldLeads(org.ctx({ now: vn('2026-10-19T08:00:00') }));
    expect(released).toHaveLength(1);
    const a = await testDb().leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId } });
    expect(a.acceptDeadline).toEqual(vn('2026-10-19T08:10:00'));
  });

  it('assignLead is a no-op for leads that are already assigned', async () => {
    const org = await createTestOrg();
    const r = await intakeLead(org.ctx(), lead());
    expect(await assignLead(org.ctx(), r.leadId)).toMatchObject({ status: 'SKIPPED' });
  });
});

describe('dedupe & routing (SPEC 6.2)', () => {
  it('same phone twice (any format) → one lead, recontact activity, owner notified', async () => {
    const org = await createTestOrg();
    const phone = nextPhone();
    const ctx = org.ctx();
    const [a, b] = await Promise.all([
      intakeLead(ctx, lead({ phone })),
      intakeLead(ctx, lead({ phone: `+84 ${phone.slice(1, 4)} ${phone.slice(4)}`, source: 'ZALO_COMPANY', need: 'Hỏi lại giá' })),
    ]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(a.leadId).toBe(b.leadId);
    const db = testDb();
    expect(await db.lead.count({ where: { orgId: org.orgId } })).toBe(1);
    expect(await db.customer.count({ where: { orgId: org.orgId } })).toBe(1);
    const recontact = await db.activity.findFirstOrThrow({ where: { leadId: a.leadId, type: 'SYSTEM', data: { path: ['kind'], equals: 'recontact' } } });
    expect(recontact).toBeTruthy();
    // Once the lead has an owner, a later recontact notifies that owner.
    const owner = (await db.lead.findUniqueOrThrow({ where: { id: a.leadId } })).ownerId as string;
    await intakeLead(ctx, lead({ phone, source: 'FACEBOOK_MESSENGER' }));
    expect(await db.notification.count({ where: { userId: owner, type: 'lead.recontact' } })).toBe(1);
  });

  it('dedupes by email when no phone matches', async () => {
    const org = await createTestOrg();
    const ctx = org.ctx();
    const a = await intakeLead(ctx, lead({ email: 'shop@example.com' }));
    const b = await intakeLead(ctx, { source: 'FACEBOOK_LEAD_ADS', fullName: 'X', email: 'SHOP@example.com' });
    expect(b).toMatchObject({ duplicate: true, leadId: a.leadId });
  });

  it('existing customer with orders → repurchase lead goes straight to the customer owner, even when BUSY', async () => {
    const org = await createTestOrg();
    const db = testDb();
    const owner = org.sales[2]!;
    const phone = nextPhone();
    const c = await db.customer.create({ data: { orgId: org.orgId, contactName: 'Shop ABC', phone: `+84${phone.slice(1)}`, ownerId: owner.id, orderCount: 3, lifecycle: 'REPEAT' } });
    await db.user.update({ where: { id: owner.id }, data: { status: 'BUSY' } });
    const r = await intakeLead(org.ctx(), lead({ phone }));
    expect(r.customerId).toBe(c.id);
    expect(r.assignment).toMatchObject({ status: 'ASSIGNED', userId: owner.id, method: 'CUSTOMER_OWNER' });
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).isRepurchase).toBe(true);
  });

  it('customer owner INACTIVE → round robin instead', async () => {
    const org = await createTestOrg();
    const db = testDb();
    const gone = await db.user.create({ data: { orgId: org.orgId, email: `gone.${Date.now()}@t.local`, fullName: 'Đã nghỉ', role: 'SALES', status: 'INACTIVE', passwordHash: 'x' } });
    const phone = nextPhone();
    await db.customer.create({ data: { orgId: org.orgId, contactName: 'Shop cũ', phone: `+84${phone.slice(1)}`, ownerId: gone.id, orderCount: 2 } });
    const r = await intakeLead(org.ctx(), lead({ phone }));
    expect(r.assignment).toMatchObject({ status: 'ASSIGNED', method: 'ROUND_ROBIN' });
  });

  it('previously LOST lead → new lead prefers the previous owner if available', async () => {
    const org = await createTestOrg();
    const db = testDb();
    const phone = nextPhone();
    const first = await intakeLead(org.ctx(), lead({ phone }));
    const prevOwner = first.assignment?.status === 'ASSIGNED' ? first.assignment.userId : '';
    await db.lead.update({ where: { id: first.leadId }, data: { status: 'LOST' } });
    const again = await intakeLead(org.ctx(), lead({ phone }));
    expect(again.duplicate).toBe(false);
    expect(again.assignment).toMatchObject({ status: 'ASSIGNED', userId: prevOwner, method: 'PREVIOUS_OWNER' });
  });

  it('Sales creating a lead keeps it (tự giao cho mình); AUTO sends it to rotation', async () => {
    const org = await createTestOrg();
    const me = org.sales[1]!;
    const self = await intakeLead(org.ctx({ actor: me }), lead({ source: 'HOTLINE', assignMode: 'SELF' }));
    expect(self.assignment).toMatchObject({ status: 'ASSIGNED', userId: me.id });
    expect((await testDb().lead.findUniqueOrThrow({ where: { id: self.leadId } })).status).toBe('IN_PROGRESS');
    await expect(intakeLead(org.ctx({ actor: me }), lead({ assignMode: 'USER', assignToUserId: org.sales[0]!.id }))).rejects.toThrow();
    const auto = await intakeLead(org.ctx({ actor: me }), lead({ source: 'ZALO_COMPANY', assignMode: 'AUTO' }));
    expect(auto.assignment).toMatchObject({ status: 'ASSIGNED', method: 'ROUND_ROBIN' });
  });

  it('rejects invalid phones and viewers', async () => {
    const org = await createTestOrg();
    await expect(intakeLead(org.ctx(), lead({ phone: '12345' }))).rejects.toThrow('Số điện thoại không hợp lệ');
    const viewer = { ...org.owner, role: 'VIEWER' as const };
    await expect(intakeLead(org.ctx({ actor: viewer }), lead())).rejects.toThrow('quyền');
  });
});
