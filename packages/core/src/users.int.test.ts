import { authenticate, MemoryLoginAttemptStore } from '@michio/auth';
import { describe, expect, it } from 'vitest';
import { createTestOrg, testDb } from '../test/fixtures';
import { changeOwnPassword, createUser, generateTempPassword, resetUserPassword, updateUser } from './users';
import { intakeLead } from './leads';

describe('Đặt lại mật khẩu (SPEC 6.1)', () => {
  it('Owner resets a sales password: temp password works once, then must be changed', async () => {
    const org = await createTestOrg();
    const db = testDb();
    const target = org.sales[0]!;
    const { tempPassword } = await resetUserPassword(org.ctx({ actor: org.owner }), target.id);
    expect(tempPassword).toMatch(/^[A-Za-z2-9]{10}$/);

    const store = new MemoryLoginAttemptStore();
    expect((await authenticate(db, store, { identifier: target.email, password: 'Michio@123' })).ok).toBe(false);
    const login = await authenticate(db, store, { identifier: target.email, password: tempPassword });
    expect(login.ok && login.user.mustChangePassword).toBe(true);

    await expect(changeOwnPassword(org.ctx({ actor: target }), { currentPassword: tempPassword, newPassword: tempPassword })).rejects.toThrow();
    await changeOwnPassword(org.ctx({ actor: target }), { currentPassword: tempPassword, newPassword: 'MatKhauMoi#2026' });
    const after = await authenticate(db, store, { identifier: target.email, password: 'MatKhauMoi#2026' });
    expect(after.ok && after.user.mustChangePassword).toBe(false);

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: target.id, action: 'user.reset_password' } });
    expect(JSON.stringify(audit)).not.toContain(tempPassword); // never log secrets
  });

  it('Manager can reset Sales but not Owner/Manager; Sales cannot reset anyone; nobody resets themselves', async () => {
    const org = await createTestOrg();
    await expect(resetUserPassword(org.ctx({ actor: org.manager }), org.sales[0]!.id)).resolves.toHaveProperty('tempPassword');
    await expect(resetUserPassword(org.ctx({ actor: org.manager }), org.owner.id)).rejects.toThrow('Chỉ chủ doanh nghiệp');
    await expect(resetUserPassword(org.ctx({ actor: org.sales[0]! }), org.sales[1]!.id)).rejects.toThrow('quyền');
    await expect(resetUserPassword(org.ctx({ actor: org.owner }), org.owner.id)).rejects.toThrow('Đổi mật khẩu');
    await expect(resetUserPassword(org.ctx({ actor: org.owner }), org.manager.id)).resolves.toHaveProperty('tempPassword');
  });

  it('generated passwords mix upper, lower and digits', () => {
    for (let i = 0; i < 50; i++) expect(generateTempPassword()).toMatch(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{10}$/);
  });
});

describe('quản lý người dùng', () => {
  it('Owner creates a user with a temp password; Manager cannot create users', async () => {
    const org = await createTestOrg();
    const { user, tempPassword } = await createUser(org.ctx({ actor: org.owner }), { email: `New.${Date.now()}@T.local`, fullName: 'Sales mới', role: 'SALES', phone: '0912 000 999' });
    expect(user.email).toBe(user.email.toLowerCase());
    expect(user).toMatchObject({ mustChangePassword: true, phone: '+84912000999' });
    expect(tempPassword).toHaveLength(10);
    await expect(createUser(org.ctx({ actor: org.manager }), { email: 'x@t.local', fullName: 'X', role: 'SALES' })).rejects.toThrow('quyền');
  });

  it('deactivating a sales re-routes their pending leads immediately', async () => {
    const org = await createTestOrg();
    const r = await intakeLead(org.ctx(), { source: 'HOTLINE', fullName: 'K', phone: '0912 777 001' });
    const holder = r.assignment?.status === 'ASSIGNED' ? r.assignment.userId : '';
    await updateUser(org.ctx({ actor: org.owner }), holder, { status: 'INACTIVE' });
    const pending = await testDb().leadAssignment.findFirstOrThrow({ where: { leadId: r.leadId, status: 'PENDING' } });
    expect(pending.userId).not.toBe(holder);
    await expect(updateUser(org.ctx({ actor: org.owner }), org.owner.id, { status: 'INACTIVE' })).rejects.toThrow();
  });
});
