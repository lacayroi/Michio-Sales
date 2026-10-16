import { randomUUID } from 'node:crypto';
import { hashPassword } from '@michio/auth';
import { PrismaClient, type Role } from '@michio/db';
import { inject } from 'vitest';
import { type AuthUser } from '@michio/auth';
import { RecordingEffects, type ServiceContext } from '../src/context';
import { DEFAULT_WEEKLY } from '../src/calendar';

let client: PrismaClient | undefined;
export function testDb(): PrismaClient {
  const url = new URL(inject('databaseUrl'));
  url.searchParams.set('connection_limit', '40');
  client ??= new PrismaClient({ datasourceUrl: url.toString() });
  return client;
}

/** Vietnam local time → Date */
export const vn = (s: string) => new Date(`${s}+07:00`);

let passwordHash: string | undefined;

export interface TestOrg {
  orgId: string;
  owner: AuthUser & { email: string };
  manager: AuthUser & { email: string };
  sales: (AuthUser & { email: string })[];
  ruleId: string;
  ctx: (opts?: { actor?: AuthUser | null; now?: Date | (() => Date) }) => ServiceContext & { effects: RecordingEffects };
}

let seq = 0;

/** Fresh org per test: owner, manager, N sales, default calendar, one ROUND_ROBIN rule. */
export async function createTestOrg(opts: { salesCount?: number; holidays?: string[] } = {}): Promise<TestOrg> {
  const db = testDb();
  passwordHash ??= await hashPassword('Michio@123');
  const n = ++seq;
  const org = await db.organization.create({ data: { name: `Test org ${n}` } });
  await db.workingCalendar.create({ data: { orgId: org.id, weekly: DEFAULT_WEEKLY as never } });
  if (opts.holidays?.length) {
    await db.holiday.createMany({ data: opts.holidays.map((d) => ({ orgId: org.id, date: new Date(`${d}T00:00:00Z`), name: 'Lễ' })) });
  }
  const mk = async (role: Role, i: number) => {
    const u = await db.user.create({
      data: { orgId: org.id, email: `${role.toLowerCase()}${i}.${randomUUID()}@test.local`, fullName: `${role} ${i}`, role, passwordHash: passwordHash as string, phone: null },
    });
    return { id: u.id, orgId: u.orgId, role: u.role, status: u.status, deletedAt: null, email: u.email };
  };
  const owner = await mk('OWNER', 1);
  const manager = await mk('MANAGER', 1);
  const sales = [];
  for (let i = 1; i <= (opts.salesCount ?? 3); i++) sales.push(await mk('SALES', i));
  const rule = await db.assignmentRule.create({
    data: { orgId: org.id, name: 'Mặc định', priority: 1000, conditions: {}, targetUserIds: sales.map((s) => s.id), method: 'ROUND_ROBIN' },
  });
  return {
    orgId: org.id,
    owner,
    manager,
    sales,
    ruleId: rule.id,
    ctx: ({ actor = null, now = vn('2026-10-15T09:00:00') } = {}) => ({
      db,
      effects: new RecordingEffects(),
      now: typeof now === 'function' ? now : () => now,
      actor,
      orgId: org.id,
      via: actor ? 'WEB' : 'SYSTEM',
    }),
  };
}

let phoneSeq = 0;
/** Unique valid VN mobile numbers. */
export const nextPhone = () => `09${String(10_000_000 + ((Date.now() % 1_000_000) * 37 + ++phoneSeq) % 89_999_999).padStart(8, '0')}`;
