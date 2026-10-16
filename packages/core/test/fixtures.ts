// Builds an isolated organisation per test so files can share one database.
import { randomUUID } from 'node:crypto';
import type { AuthUser, Role } from '@michio/auth';
import { type Prisma, PrismaClient } from '@michio/db';
import { inject } from 'vitest';
import { type Actor, userActor } from '../src/context';

let client: PrismaClient | undefined;
export function testDb(): PrismaClient {
  client ??= new PrismaClient({ datasourceUrl: inject('databaseUrl') });
  return client;
}

export interface TestOrg {
  orgId: string;
  owner: AuthUser & { fullName: string };
  manager: AuthUser & { fullName: string };
  sales: (AuthUser & { fullName: string })[];
  support: AuthUser & { fullName: string };
  ruleId: string;
  as(user: AuthUser): Actor;
}

export async function createTestOrg(
  db: PrismaClient,
  opts: { settings?: Record<string, Prisma.InputJsonValue>; salesCount?: number; rule?: Partial<Prisma.AssignmentRuleUncheckedCreateInput> } = {},
): Promise<TestOrg> {
  const org = await db.organization.create({ data: { name: `Test ${randomUUID().slice(0, 8)}` } });
  const orgId = org.id;
  await db.workingCalendar.create({
    data: { orgId, weekly: [1, 2, 3, 4, 5, 6].map((dow) => ({ dow, ranges: [['08:00', '12:00'], ['13:30', '17:30']] })) },
  });
  // Wall-clock SLAs by default so tests don't depend on the time of day they run.
  const settings = { 'sla.businessHoursOnly': false, ...opts.settings };
  await db.setting.createMany({ data: Object.entries(settings).map(([key, value]) => ({ orgId, key, value })) });
  await db.pipelineStage.createMany({
    data: [
      { orgId, code: 'MOI', name: 'Mới', order: 1, probability: 10 },
      { orgId, code: 'THUA', name: 'Không thành công', order: 6, probability: 0, isLost: true },
    ],
  });
  await db.lostReason.create({ data: { orgId, name: 'Chỉ hỏi giá' } });

  let n = 0;
  const mk = async (role: Role, name: string) => {
    n++;
    const u = await db.user.create({
      data: { orgId, email: `${role.toLowerCase()}${n}@test.local`, fullName: name, role, passwordHash: 'x', phone: `+8490400${String(n).padStart(4, '0')}`, createdAt: new Date(Date.now() + n) },
    });
    return { id: u.id, orgId, role: u.role, status: u.status, deletedAt: null, fullName: u.fullName };
  };
  const owner = await mk('OWNER', 'Chủ');
  const manager = await mk('MANAGER', 'Quản lý');
  const sales = [];
  for (let i = 0; i < (opts.salesCount ?? 3); i++) sales.push(await mk('SALES', `Sales ${i + 1}`));
  const support = await mk('SUPPORT', 'Kế toán');
  const rule = await db.assignmentRule.create({
    data: { orgId, name: 'Mặc định', priority: 1000, conditions: {}, targetUserIds: sales.map((s) => s.id), method: 'ROUND_ROBIN', ...opts.rule },
  });
  return { orgId, owner, manager, sales, support, ruleId: rule.id, as: (u) => userActor(u) };
}

const phoneBase = Math.floor(Math.random() * 80_000_000);
let phoneSeq = 0;
/** Unique valid mobile numbers: 09xxxxxxxx */
export function phone(): string {
  return `09${String(phoneBase + ++phoneSeq).padStart(8, '0')}`;
}
