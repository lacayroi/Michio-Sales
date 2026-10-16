// SPEC §12 integration: form → lead → chia → hết hạn → thu hồi → chia lại; khách cũ quay lại;
// 90 lead song song → 30/30/30; sales OFF không nhận lead.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, phone, type TestOrg, testDb } from '../../test/fixtures';
import { apiActor, systemActor } from '../context';
import { recordingEffects } from '../effects';
import { intakeLead, type LeadIntakeInput } from '../leads/intake';
import { addLeadActivity } from '../leads/service';
import { simulateAssignment } from './admin';
import { acceptLead, assignLeads, expireAssignment, releaseHeldLeads, returnLead, routeLead, sweepSla } from './engine';

const db = testDb();
afterAll(() => db.$disconnect());

const form = (extra: Partial<LeadIntakeInput> = {}): LeadIntakeInput => ({
  source: 'WEBSITE_WHOLESALE_FORM',
  contactName: 'Nguyễn Thị Hoa',
  phone: phone(),
  shopName: 'Shop Mẹ & Bé Hoa',
  province: 'Hải Phòng',
  businessModel: 'ONLINE_SHOP',
  expectedOrderBand: 'B10_30M',
  interestCategories: ['MATCHA_TEA'],
  ...extra,
});

const MIN = 60_000;

describe('round-robin intake (DoD M1)', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg(db);
  });

  it('website form → lead assigned within the request, notification + SLA job scheduled', async () => {
    const fx = recordingEffects();
    const t0 = Date.now();
    const r = await intakeLead(db, fx, apiActor(org.orgId), form());
    expect(Date.now() - t0).toBeLessThan(10_000); // G1: lead → được giao < 10 giây
    expect(r.duplicate).toBe(false);
    expect(r.assignedTo?.id).toBe(org.sales[0]!.id);
    expect(r.code).toBeGreaterThan(1000);

    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId }, include: { assignments: true, customer: true } });
    expect(lead.status).toBe('ASSIGNED');
    expect(lead.priority).toBe('WARM'); // 10–30tr → WARM (5.1)
    expect(lead.customer.ownerId).toBe(org.sales[0]!.id);
    expect(lead.assignments).toHaveLength(1);
    const a = lead.assignments[0]!;
    expect(a.status).toBe('PENDING');
    expect(a.acceptDeadline!.getTime() - a.createdAt.getTime()).toBe(10 * MIN);
    expect(fx.slaChecks).toEqual([{ assignmentId: a.id, deadline: a.acceptDeadline }]);
    expect(fx.events.map((e) => e.type)).toEqual(expect.arrayContaining(['lead.assigned', 'notification.new']));
    expect(await db.notification.count({ where: { userId: org.sales[0]!.id, type: 'lead.assigned' } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: r.leadId, action: { in: ['lead.create', 'lead.assign'] } } })).toBe(2);
  });

  it('HOT lead gets the 5-minute accept window', async () => {
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ expectedOrderBand: 'GT_50M' }));
    const a = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId } });
    expect(a.acceptDeadline!.getTime() - a.createdAt.getTime()).toBe(5 * MIN);
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).priority).toBe('HOT');
  });

  it('continues the rotation and skips an OFF sales (AC 6.3)', async () => {
    // previous tests used sales[0], sales[1] → next turn is sales[2]
    await db.user.update({ where: { id: org.sales[2]!.id }, data: { status: 'OFF' } });
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    expect(r.assignedTo?.id).toBe(org.sales[0]!.id);
    const r2 = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    expect(r2.assignedTo?.id).toBe(org.sales[1]!.id);
    await db.user.update({ where: { id: org.sales[2]!.id }, data: { status: 'AVAILABLE' } });
    const r3 = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    expect(r3.assignedTo?.id).toBe(org.sales[2]!.id);
  });

  it('a sales on leave or at maxOpenLeads is skipped', async () => {
    const [s0, s1, s2] = org.sales;
    await db.userLeave.create({ data: { userId: s0!.id, startAt: new Date(Date.now() - MIN), endAt: new Date(Date.now() + 86_400_000) } });
    await db.user.update({ where: { id: s1!.id }, data: { maxOpenLeads: 1 } });
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    expect(r.assignedTo?.id).toBe(s2!.id);
    await db.userLeave.deleteMany({ where: { userId: s0!.id } });
    await db.user.update({ where: { id: s1!.id }, data: { maxOpenLeads: 40 } });
  });
});

describe('accept / return / expire / reassign', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg(db, { rule: { maxReassign: 2 } });
  });

  it('accept → IN_PROGRESS with first-contact deadline; late accept rejected', async () => {
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    const s = org.sales.find((x) => x.id === r.assignedTo!.id)!;
    await expect(acceptLead(db, recordingEffects(), org.as(org.sales.find((x) => x.id !== s.id)!), r.leadId)).rejects.toMatchObject({ code: 'NOT_PENDING' });
    const res = await acceptLead(db, recordingEffects(), org.as(s), r.leadId);
    expect(res.status).toBe('IN_PROGRESS');
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId } });
    expect(lead.acceptedAt).not.toBeNull();
    expect(lead.firstContactDeadline!.getTime() - lead.acceptedAt!.getTime()).toBe(30 * MIN);

    const r2 = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    await db.leadAssignment.updateMany({ where: { leadId: r2.leadId }, data: { acceptDeadline: new Date(Date.now() - 1000) } });
    const s2 = org.sales.find((x) => x.id === r2.assignedTo!.id)!;
    await expect(acceptLead(db, recordingEffects(), org.as(s2), r2.leadId)).rejects.toMatchObject({ code: 'ACCEPT_EXPIRED' });
  });

  it('expire → reclaimed, rerouted to someone else, never back to the same sales; > maxReassign → queue + Owner alert', async () => {
    const fx = recordingEffects();
    const r = await intakeLead(db, fx, apiActor(org.orgId), form());
    const holders = [r.assignedTo!.id];
    for (let i = 0; i < 2; i++) {
      const a = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'PENDING' } });
      const later = new Date(a.acceptDeadline!.getTime() + 1000);
      const res = await expireAssignment(db, fx, a.id, later);
      expect(res.skipped).toBe(false);
      // idempotent: a second run (job retry, sweeper) does nothing
      expect((await expireAssignment(db, fx, a.id, later)).skipped).toBe(true);
      const next = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'PENDING' } });
      expect(holders).not.toContain(next.userId);
      holders.push(next.userId);
    }
    expect(new Set(holders).size).toBe(3);
    expect(await db.notification.count({ where: { userId: holders[0], type: 'lead.reclaimed' } })).toBe(1);

    // third expiry exceeds maxReassign = 2 → hàng chờ
    const a = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'PENDING' } });
    await expireAssignment(db, fx, a.id, new Date(a.acceptDeadline!.getTime() + 1000));
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId } });
    expect(lead.status).toBe('UNASSIGNED');
    expect(lead.ownerId).toBeNull();
    expect(lead.reassignCount).toBe(3);
    expect(await db.notification.count({ where: { userId: org.owner.id, type: 'lead.queued', link: `/leads/${r.leadId}` } })).toBe(1);
  });

  it('return → next sales, the returner is excluded afterwards', async () => {
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    const first = org.sales.find((x) => x.id === r.assignedTo!.id)!;
    const out = await returnLead(db, recordingEffects(), org.as(first), r.leadId, 'Không đúng khu vực');
    expect(out.kind).toBe('ASSIGNED');
    if (out.kind !== 'ASSIGNED') return;
    expect(out.userId).not.toBe(first.id);
    const ret = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, userId: first.id } });
    expect(ret).toMatchObject({ status: 'RETURNED', returnReason: 'Không đúng khu vực' });
    // owner/manager cannot "return"
    await expect(returnLead(db, recordingEffects(), org.as(org.owner), r.leadId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sla-sweeper reclaims overdue assignments (safety net) within one pass', async () => {
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    const a = await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'PENDING' } });
    const res = await sweepSla(db, recordingEffects(), new Date(a.acceptDeadline!.getTime() + 30_000), { orgId: org.orgId });
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect((await db.leadAssignment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('EXPIRED');
  });

  it('first call counts as first contact and implicitly accepts', async () => {
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    const s = org.sales.find((x) => x.id === r.assignedTo!.id)!;
    await addLeadActivity(db, recordingEffects(), org.as(s), r.leadId, { type: 'CALL', result: 'ANSWERED', note: 'Đã tư vấn' });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId }, include: { assignments: true } });
    expect(lead.status).toBe('IN_PROGRESS');
    expect(lead.firstContactAt).not.toBeNull();
    expect(lead.assignments[0]!.status).toBe('ACCEPTED');
  });

  it('contact-SLA breach is flagged once to sales + owner', async () => {
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    const s = org.sales.find((x) => x.id === r.assignedTo!.id)!;
    await acceptLead(db, recordingEffects(), org.as(s), r.leadId);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId } });
    const later = new Date(lead.firstContactDeadline!.getTime() + 1000);
    await sweepSla(db, recordingEffects(), later, { orgId: org.orgId });
    await sweepSla(db, recordingEffects(), later, { orgId: org.orgId });
    expect(await db.notification.count({ where: { type: 'lead.contactOverdue', link: `/leads/${r.leadId}` } })).toBe(3); // sales + owner + manager
  });
});

describe('returning customers (SPEC 6.2)', () => {
  let org: TestOrg;
  beforeAll(async () => {
    org = await createTestOrg(db);
  });

  it('open lead → no new lead, activity "liên hệ lại", owner notified', async () => {
    const p = phone();
    const r1 = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ phone: p }));
    const r2 = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ phone: p.replace(/^0/, '+84'), source: 'ZALO_COMPANY', need: 'Hỏi lại giá matcha' }));
    expect(r2).toMatchObject({ duplicate: true, leadId: r1.leadId, existingCustomer: true });
    expect(await db.lead.count({ where: { customerId: r1.customerId } })).toBe(1);
    expect(await db.activity.count({ where: { leadId: r1.leadId, type: 'SYSTEM', data: { path: ['kind'], equals: 'RECONTACT' } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: r1.assignedTo!.id, type: 'lead.recontact' } })).toBe(1);
  });

  it('concurrent duplicate submissions → 1 customer, 1 lead', async () => {
    const p = phone();
    const results = await Promise.all(Array.from({ length: 5 }, () => intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ phone: p }))));
    expect(new Set(results.map((r) => r.leadId)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await db.customer.count({ where: { orgId: org.orgId, phone: `+84${p.slice(1)}` } })).toBe(1);
  });

  it('buying customer → repurchase lead straight to the owning sales; INACTIVE owner → rotation', async () => {
    const owner = org.sales[2]!;
    const c = await db.customer.create({ data: { orgId: org.orgId, contactName: 'Shop ABC', phone: `+84${phone().slice(1)}`, ownerId: owner.id, orderCount: 3, lifecycle: 'REPEAT' } });
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ phone: c.phone }));
    expect(r.isRepurchase).toBe(true);
    expect(r.assignedTo?.id).toBe(owner.id);
    expect((await db.leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId } })).method).toBe('CUSTOMER_OWNER');
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).ownerId).toBe(owner.id);

    await db.lead.update({ where: { id: r.leadId }, data: { status: 'WON' } });
    await db.user.update({ where: { id: owner.id }, data: { status: 'INACTIVE' } });
    const r2 = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ phone: c.phone }));
    expect(r2.assignedTo?.id).not.toBe(owner.id);
    expect((await db.leadAssignment.findFirstOrThrow({ where: { leadId: r2.leadId } })).method).toBe('ROUND_ROBIN');
    await db.user.update({ where: { id: owner.id }, data: { status: 'AVAILABLE' } });
  });

  it('lost before → previous sales preferred', async () => {
    const prev = org.sales[1]!;
    const p = phone();
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ phone: p }));
    await assignLeads(db, recordingEffects(), org.as(org.owner), [r.leadId], { userId: prev.id });
    await db.lead.update({ where: { id: r.leadId }, data: { status: 'LOST' } });
    const r2 = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form({ phone: p }));
    expect(r2.duplicate).toBe(false);
    expect(r2.assignedTo?.id).toBe(prev.id);
    expect((await db.leadAssignment.findFirstOrThrow({ where: { leadId: r2.leadId } })).method).toBe('PREVIOUS_OWNER');
  });

  it('SALES creating a lead keeps it (§3), already accepted', async () => {
    const s = org.sales[0]!;
    const r = await intakeLead(db, recordingEffects(), org.as(s), { source: 'ZALO_COMPANY', contactName: 'Chị Lan', phone: phone(), need: 'Quan tâm matcha' });
    expect(r.assignedTo?.id).toBe(s.id);
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).status).toBe('IN_PROGRESS');
    // SUPPORT cannot create leads
    await expect(intakeLead(db, recordingEffects(), org.as(org.support), form())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('manual assignment, HOLD mode, simulation', () => {
  it('manager bulk-assigns; the lead history keeps every assignment', async () => {
    const org = await createTestOrg(db);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await intakeLead(db, recordingEffects(), apiActor(org.orgId), form())).leadId);
    const target = org.sales[1]!;
    const res = await assignLeads(db, recordingEffects(), org.as(org.manager), ids, { userId: target.id });
    expect(res.every((r) => !r.error)).toBe(true);
    const leads = await db.lead.findMany({ where: { id: { in: ids } } });
    expect(leads.every((l) => l.ownerId === target.id && l.status === 'IN_PROGRESS')).toBe(true);
    const hist = await db.leadAssignment.findMany({ where: { leadId: ids[0] }, orderBy: { createdAt: 'asc' } });
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist.at(-1)).toMatchObject({ userId: target.id, assignedById: org.manager.id, status: 'ACCEPTED' });
    await expect(assignLeads(db, recordingEffects(), org.as(org.sales[0]!), ids, { userId: target.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assignLeads(db, recordingEffects(), org.as(org.owner), [ids[0]!], { userId: org.support.id })).rejects.toMatchObject({ code: 'INVALID_ASSIGNEE' });
  });

  it('outOfHoursMode = HOLD keeps leads NEW outside working hours, released at opening', async () => {
    const org = await createTestOrg(db, {
      settings: { 'sla.businessHoursOnly': true, 'assignment.outOfHoursMode': 'HOLD' },
    });
    // No working hours at all today-now → make the calendar closed, so "now" is off hours.
    await db.workingCalendar.update({ where: { orgId: org.orgId }, data: { weekly: [{ dow: 0, ranges: [['00:00', '00:01']] }] } });
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    expect(r.assignedTo).toBeNull();
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).status).toBe('NEW');
    // Open around the clock → the 08:00 job releases it.
    await db.workingCalendar.update({ where: { orgId: org.orgId }, data: { weekly: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, ranges: [['00:00', '23:59']] })) } });
    const out = await releaseHeldLeads(db, recordingEffects(), org.orgId, new Date(new Date().setUTCHours(3, 0, 0, 0)));
    expect(out.released).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).status).toBe('ASSIGNED');
  });

  it('"Thử luật" explains the pick without moving the rotation', async () => {
    const org = await createTestOrg(db);
    await db.user.update({ where: { id: org.sales[0]!.id }, data: { status: 'BUSY' } });
    const sim = await simulateAssignment(db, org.as(org.owner), { source: 'WEBSITE_WHOLESALE_FORM', expectedOrderBand: 'GT_50M' });
    expect(sim.path).toBe('RULE');
    expect(sim.picked?.id).toBe(org.sales[1]!.id);
    expect(sim.candidates.find((c) => c.id === org.sales[0]!.id)).toMatchObject({ eligible: false });
    expect((await db.assignmentRule.findUniqueOrThrow({ where: { id: org.ruleId } })).rrCursor).toBe(0);
    await expect(simulateAssignment(db, org.as(org.sales[1]!), { source: 'MANUAL' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('no active rule → queue + owner notified', async () => {
    const org = await createTestOrg(db);
    await db.assignmentRule.update({ where: { id: org.ruleId }, data: { isActive: false } });
    const r = await intakeLead(db, recordingEffects(), apiActor(org.orgId), form());
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).status).toBe('UNASSIGNED');
    expect(await db.notification.count({ where: { userId: org.owner.id, type: 'lead.queued' } })).toBe(1);
    // assigning automatically later (after re-enabling the rule) works
    await db.assignmentRule.update({ where: { id: org.ruleId }, data: { isActive: true } });
    const out = await routeLead(db, recordingEffects(), systemActor(org.orgId), r.leadId);
    expect(out.kind).toBe('ASSIGNED');
  });
});

describe('concurrency (SPEC §12)', () => {
  it('90 leads created in parallel → 30/30/30 (±1), unique codes', async () => {
    const org = await createTestOrg(db);
    const results = await Promise.all(Array.from({ length: 90 }, () => intakeLead(db, recordingEffects(), apiActor(org.orgId), form())));
    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.assignedTo!.id, (counts.get(r.assignedTo!.id) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([30, 30, 30]);
    expect(new Set(results.map((r) => r.code)).size).toBe(90);
  });
});
