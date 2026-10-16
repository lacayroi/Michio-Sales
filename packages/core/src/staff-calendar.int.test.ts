// Working hours editable from settings (SPEC A1/0.1.4) and staff leave (6.1, §8 /users/:id/leaves).
import { afterAll, describe, expect, it } from 'vitest';
import { createTestOrg, nextPhone, testDb, vn } from '../test/fixtures';
import { intakeLead } from './leads';
import { addLeave, deleteLeave, listLeaves, setWorkingCalendar } from './staff-calendar';

const db = testDb();
afterAll(() => db.$disconnect());

describe('working hours', () => {
  it('Owner/Manager change the hours; SLA deadlines follow immediately', async () => {
    const org = await createTestOrg();
    const now = vn('2026-10-15T17:25:00'); // Thursday
    // Close at 17:00 instead of 17:30 → a 10-minute accept window starting 17:25 opens tomorrow 08:00.
    await setWorkingCalendar(org.ctx({ actor: org.manager, now }), {
      weekly: [1, 2, 3, 4, 5, 6].map((dow) => ({ dow, ranges: [['08:00', '12:00'], ['13:30', '17:00']] as [string, string][] })),
    });
    const r = await intakeLead(org.ctx({ now }), { source: 'HOTLINE', fullName: 'Khách giờ mới', phone: nextPhone() });
    expect(r.assignment).toMatchObject({ status: 'ASSIGNED', acceptDeadline: vn('2026-10-16T08:10:00') });
    expect(await db.auditLog.count({ where: { orgId: org.orgId, action: 'settings.workingCalendar' } })).toBe(1);
  });

  it('rejects overlapping ranges, an empty week, and sales users', async () => {
    const org = await createTestOrg();
    const ctx = org.ctx({ actor: org.owner });
    await expect(setWorkingCalendar(ctx, { weekly: [{ dow: 1, ranges: [['08:00', '12:00'], ['11:00', '17:00']] }] })).rejects.toThrow(/chồng nhau/);
    await expect(setWorkingCalendar(ctx, { weekly: [] })).rejects.toThrow(/ít nhất một ngày/);
    await expect(setWorkingCalendar(org.ctx({ actor: org.sales[0]! }), { weekly: [{ dow: 1, ranges: [['08:00', '17:00']] }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('staff leave', () => {
  it('a sales on leave is skipped by rotation; a running leave hands back their pending leads', async () => {
    const org = await createTestOrg();
    const now = vn('2026-10-15T09:00:00');
    const owner = org.ctx({ actor: org.owner, now });
    const s1 = org.sales[0]!;

    const first = await intakeLead(org.ctx({ now }), { source: 'HOTLINE', fullName: 'Khách A', phone: nextPhone() });
    expect(first.assignment).toMatchObject({ status: 'ASSIGNED', userId: s1.id });

    const leave = await addLeave(owner, s1.id, { startAt: vn('2026-10-15T00:00:00'), endAt: vn('2026-10-17T00:00:00'), reason: 'Nghỉ phép năm' });
    // the pending lead moved on, and new leads skip s1
    const lead = await db.lead.findUniqueOrThrow({ where: { id: first.leadId } });
    expect(lead.ownerId).not.toBe(s1.id);
    for (let i = 0; i < 3; i++) {
      const r = await intakeLead(org.ctx({ now }), { source: 'HOTLINE', fullName: `Khách ${i}`, phone: nextPhone() });
      expect(r.assignment).toMatchObject({ status: 'ASSIGNED' });
      expect((r.assignment as { userId: string }).userId).not.toBe(s1.id);
    }

    expect(await listLeaves(owner, s1.id, { upcomingOnly: true })).toHaveLength(1);
    await expect(addLeave(owner, s1.id, { startAt: vn('2026-10-16T00:00:00'), endAt: vn('2026-10-18T00:00:00') })).rejects.toThrow(/Trùng/);
    await expect(addLeave(org.ctx({ actor: org.manager, now }), s1.id, { startAt: vn('2026-11-01T00:00:00'), endAt: vn('2026-11-02T00:00:00') })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(addLeave(owner, s1.id, { startAt: vn('2026-11-02T00:00:00'), endAt: vn('2026-11-01T00:00:00') })).rejects.toThrow(/sau ngày bắt đầu/);

    await deleteLeave(owner, s1.id, leave.id);
    const back = await intakeLead(org.ctx({ now }), { source: 'HOTLINE', fullName: 'Khách quay lại', phone: nextPhone() });
    expect(back.assignment).toMatchObject({ status: 'ASSIGNED' });
    expect(await db.auditLog.count({ where: { entityId: s1.id, action: { in: ['user.leave.create', 'user.leave.delete'] } } })).toBe(2);
  });

  it('a sales can read their own leaves, not someone else’s', async () => {
    const org = await createTestOrg();
    await expect(listLeaves(org.ctx({ actor: org.sales[0]! }), org.sales[0]!.id)).resolves.toEqual([]);
    await expect(listLeaves(org.ctx({ actor: org.sales[0]! }), org.sales[1]!.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
