import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@michio/db';
import { authenticate, LOCKOUT_SECONDS, MAX_FAILED_LOGINS, MemoryLoginAttemptStore } from './login';
import { hashPassword } from './password';

let user: User;
function fakeDb(users: User[]) {
  return {
    user: {
      findFirst: async ({ where }: { where: { email?: string; phone?: string; deletedAt: null } }) =>
        users.find(
          (u) => !u.deletedAt && (where.email ? u.email === where.email : u.phone === where.phone),
        ) ?? null,
    },
  } as never;
}

beforeAll(async () => {
  user = {
    id: 'u1',
    orgId: 'o1',
    email: 'sale1@michio.local',
    phone: '+84904000011',
    fullName: 'Sale 1',
    passwordHash: await hashPassword('Michio@123'),
    role: 'SALES',
    status: 'AVAILABLE',
    maxOpenLeads: 40,
    zaloBotChatId: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
});

describe('authenticate', () => {
  it('accepts email (case-insensitive) or phone in any VN format', async () => {
    const db = fakeDb([user]);
    const store = new MemoryLoginAttemptStore();
    expect((await authenticate(db, store, { identifier: 'Sale1@Michio.local', password: 'Michio@123' })).ok).toBe(true);
    expect((await authenticate(db, store, { identifier: '0904 000 011', password: 'Michio@123' })).ok).toBe(true);
  });

  it('rejects wrong password and unknown user with the same code', async () => {
    const db = fakeDb([user]);
    const store = new MemoryLoginAttemptStore();
    expect(await authenticate(db, store, { identifier: user.email, password: 'wrong' })).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' });
    expect(await authenticate(db, store, { identifier: 'nobody@x.vn', password: 'wrong' })).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' });
  });

  it('locks for 15 minutes after 5 failures, even with the right password', async () => {
    let now = 1_000_000;
    const db = fakeDb([user]);
    const store = new MemoryLoginAttemptStore(() => now);
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      expect((await authenticate(db, store, { identifier: user.email, password: 'x' })) .ok).toBe(false);
    }
    expect(await authenticate(db, store, { identifier: user.email, password: 'x' })).toEqual({ ok: false, code: 'LOCKED' });
    expect(await authenticate(db, store, { identifier: user.email, password: 'Michio@123' })).toEqual({ ok: false, code: 'LOCKED' });
    now += LOCKOUT_SECONDS * 1000 + 1;
    expect((await authenticate(db, store, { identifier: user.email, password: 'Michio@123' })).ok).toBe(true);
  });

  it('refuses inactive users', async () => {
    const db = fakeDb([{ ...user, status: 'INACTIVE' }]);
    const store = new MemoryLoginAttemptStore();
    expect(await authenticate(db, store, { identifier: user.email, password: 'Michio@123' })).toEqual({ ok: false, code: 'INACTIVE' });
  });
});
