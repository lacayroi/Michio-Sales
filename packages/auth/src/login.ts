import type { PrismaClient, User } from '@michio/db';
import { normalizeVnPhone } from '@michio/shared';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';

/** Counts failed logins per identifier (SPEC 6.1: khóa 15 phút sau 5 lần sai). */
export interface LoginAttemptStore {
  get(key: string): Promise<number>;
  /** Increments and returns the new count; the counter expires `ttlSeconds` after the first failure. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  reset(key: string): Promise<void>;
}

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_SECONDS = 15 * 60;

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; code: 'INVALID_CREDENTIALS' | 'LOCKED' | 'INACTIVE' };

// Verifying unknown identifiers against a throwaway hash keeps response timing similar.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomUUID()));

export function loginKey(identifier: string): string {
  const id = identifier.trim().toLowerCase();
  return `login-fail:${id.includes('@') ? id : (normalizeVnPhone(id) ?? id)}`;
}

export async function authenticate(
  db: Pick<PrismaClient, 'user'>,
  store: LoginAttemptStore,
  input: { identifier: string; password: string },
): Promise<LoginResult> {
  const key = loginKey(input.identifier);
  if ((await store.get(key)) >= MAX_FAILED_LOGINS) return { ok: false, code: 'LOCKED' };

  const identifier = input.identifier.trim();
  const where = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : { phone: normalizeVnPhone(identifier) ?? '__invalid__' };
  const user = await db.user.findFirst({ where: { ...where, deletedAt: null } });

  const valid = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);
  if (!user || !valid) {
    const count = await store.increment(key, LOCKOUT_SECONDS);
    return { ok: false, code: count >= MAX_FAILED_LOGINS ? 'LOCKED' : 'INVALID_CREDENTIALS' };
  }
  if (user.status === 'INACTIVE') return { ok: false, code: 'INACTIVE' };

  await store.reset(key);
  return { ok: true, user };
}

/** In-process store for tests and single-instance dev. Production uses Redis (apps/web). */
export class MemoryLoginAttemptStore implements LoginAttemptStore {
  private map = new Map<string, { count: number; expiresAt: number }>();
  constructor(private now: () => number = Date.now) {}
  async get(key: string) {
    const e = this.map.get(key);
    if (!e || e.expiresAt <= this.now()) return 0;
    return e.count;
  }
  async increment(key: string, ttlSeconds: number) {
    const e = this.map.get(key);
    if (!e || e.expiresAt <= this.now()) {
      this.map.set(key, { count: 1, expiresAt: this.now() + ttlSeconds * 1000 });
      return 1;
    }
    e.count += 1;
    return e.count;
  }
  async reset(key: string) {
    this.map.delete(key);
  }
}
