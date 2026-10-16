import { describe, expect, it } from 'vitest';
import { createTestOrg, testDb } from '../test/fixtures';
import { computeLifecycle, mergeCustomers, suggestMerges, updateCustomer } from './customers';
import { intakeLead } from './leads';

describe('customers', () => {
  it('Messenger profile + phone lead → suggested and merged into one customer', async () => {
    const org = await createTestOrg();
    const db = testDb();
    const ch = await db.channelAccount.create({ data: { orgId: org.orgId, type: 'FACEBOOK_PAGE', name: 'FB', externalId: `p${Date.now()}` } });
    const fb = await intakeLead(org.ctx(), { source: 'FACEBOOK_MESSENGER', fullName: 'Lan Anh', identity: { channelAccountId: ch.id, externalUserId: 'psid-1' } });
    await updateCustomer(org.ctx({ actor: org.owner }), fb.customerId, { province: 'Hải Phòng' });
    const ph = await intakeLead(org.ctx(), { source: 'WEBSITE_WHOLESALE_FORM', fullName: 'Lan Anh', phone: '0912 888 111', province: 'Hải Phòng' });
    expect(ph.customerId).not.toBe(fb.customerId);

    const suggestions = await suggestMerges(org.ctx({ actor: org.owner }), ph.customerId);
    expect(suggestions.map((s) => s.id)).toEqual([fb.customerId]);

    await mergeCustomers(org.ctx({ actor: org.owner }), ph.customerId, fb.customerId);
    const merged = await db.customer.findUniqueOrThrow({ where: { id: ph.customerId }, include: { identities: true, leads: true } });
    expect(merged.identities.map((i) => i.externalUserId)).toEqual(['psid-1']);
    expect(merged.leads).toHaveLength(2);
    expect((await db.customer.findUniqueOrThrow({ where: { id: fb.customerId } })).deletedAt).not.toBeNull();
    expect(await db.activity.count({ where: { customerId: ph.customerId, type: 'MERGE' } })).toBe(1);
    // A later Messenger message from the same PSID lands on the merged customer.
    const again = await intakeLead(org.ctx(), { source: 'FACEBOOK_MESSENGER', fullName: 'Lan Anh', identity: { channelAccountId: ch.id, externalUserId: 'psid-1' } });
    expect(again.customerId).toBe(ph.customerId);
  });

  it('Sales can edit only their own customers; phone clashes point to merge', async () => {
    const org = await createTestOrg();
    const a = await intakeLead(org.ctx(), { source: 'HOTLINE', fullName: 'A', phone: '0912 555 001' });
    const b = await intakeLead(org.ctx(), { source: 'HOTLINE', fullName: 'B', phone: '0912 555 002' });
    const ownerA = (await testDb().customer.findUniqueOrThrow({ where: { id: a.customerId } })).ownerId as string;
    const salesA = org.sales.find((s) => s.id === ownerA)!;
    await expect(updateCustomer(org.ctx({ actor: salesA }), b.customerId, { shopName: 'X' })).rejects.toThrow('quyền');
    await expect(updateCustomer(org.ctx({ actor: salesA }), a.customerId, { phone: '0912555002' })).rejects.toThrow('Gộp');
    const u = await updateCustomer(org.ctx({ actor: salesA }), a.customerId, { shopName: 'Shop A', phone: '+84 912 555 009' });
    expect(u).toMatchObject({ shopName: 'Shop A', phone: '+84912555009' });
    expect(await testDb().auditLog.count({ where: { entityId: a.customerId, action: 'customer.update' } })).toBe(1);
  });

  it('computeLifecycle follows SPEC 6.5', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
    expect(computeLifecycle({ orderCount: 0, lastOrderAt: null, reorderCycleDays: 30 }, now)).toBe('PROSPECT');
    expect(computeLifecycle({ orderCount: 1, lastOrderAt: ago(10), reorderCycleDays: 30 }, now)).toBe('NEW_CUSTOMER');
    expect(computeLifecycle({ orderCount: 2, lastOrderAt: ago(44), reorderCycleDays: 30 }, now)).toBe('REPEAT');
    expect(computeLifecycle({ orderCount: 2, lastOrderAt: ago(46), reorderCycleDays: 30 }, now)).toBe('AT_RISK');
    expect(computeLifecycle({ orderCount: 5, lastOrderAt: ago(91), reorderCycleDays: 30 }, now)).toBe('DORMANT');
  });
});
