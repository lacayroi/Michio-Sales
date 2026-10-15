// Configuration services: assignment rules (S15), holidays, API keys (S17).
import { createHash, randomBytes } from 'node:crypto';
import { assertAuthorized } from '@michio/auth';
import type { Prisma } from '@michio/db';
import { z } from 'zod';
import { recordAudit } from './audit';
import type { ServiceContext } from './context';
import { DomainError, notFound } from './errors';
import { RuleConditions } from './rules';
import { getSetting, setSetting } from './settings';

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

// ---------- assignment rules ----------

export const RuleInput = z.object({
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean().default(true),
  conditions: RuleConditions.default({}),
  targetUserIds: z.array(z.string()).max(50),
  method: z.enum(['ROUND_ROBIN', 'WEIGHTED', 'LEAST_LOADED', 'MANUAL']),
  autoAccept: z.boolean().default(false),
  acceptSlaMinutes: z.number().int().min(1).max(1440).default(10),
  hotAcceptSlaMinutes: z.number().int().min(1).max(1440).default(5),
  firstContactSlaMinutes: z.number().int().min(1).max(10080).default(30),
  maxReassign: z.number().int().min(1).max(20).default(3),
  fallback: z.enum(['NEXT_RULE', 'QUEUE']).default('QUEUE'),
});

async function validTargets(ctx: ServiceContext, ids: string[]) {
  if (!ids.length) return;
  const found = await ctx.db.user.count({ where: { id: { in: ids }, orgId: ctx.orgId, deletedAt: null } });
  if (found !== new Set(ids).size) throw new DomainError('VALIDATION_ERROR', 'Danh sách người nhận có người không hợp lệ');
}

export async function createRule(ctx: ServiceContext, raw: z.input<typeof RuleInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'assignmentRule.manage');
  const input = RuleInput.parse(raw);
  await validTargets(ctx, input.targetUserIds);
  return ctx.db.$transaction(async (tx) => {
    // New rules go before the catch-all default (the last rule).
    const rules = await tx.assignmentRule.findMany({ where: { orgId: ctx.orgId }, orderBy: { priority: 'asc' } });
    const last = rules[rules.length - 1];
    const priority = last ? last.priority - 1 : 1000;
    const rule = await tx.assignmentRule.create({ data: { ...input, orgId: ctx.orgId, priority } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'assignmentRule.create', entityType: 'AssignmentRule', entityId: rule.id, after: input as Prisma.InputJsonValue, ip: ctx.ip });
    return rule;
  });
}

export async function updateRule(ctx: ServiceContext, ruleId: string, raw: Partial<z.input<typeof RuleInput>>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'assignmentRule.manage');
  const input = RuleInput.partial().parse(raw);
  if (input.targetUserIds) await validTargets(ctx, input.targetUserIds);
  return ctx.db.$transaction(async (tx) => {
    const r = await tx.assignmentRule.findFirst({ where: { id: ruleId, orgId: ctx.orgId } });
    if (!r) throw notFound('luật chia');
    const next = await tx.assignmentRule.update({
      where: { id: r.id },
      // Changing the target list invalidates the cursor/weights.
      data: { ...input, ...(input.targetUserIds ? { rrCursor: 0, weightState: undefined } : {}) },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'assignmentRule.update', entityType: 'AssignmentRule', entityId: r.id,
      before: { name: r.name, method: r.method, targetUserIds: r.targetUserIds, conditions: r.conditions as Prisma.InputJsonValue, isActive: r.isActive },
      after: input as Prisma.InputJsonValue, ip: ctx.ip,
    });
    return next;
  });
}

export async function deleteRule(ctx: ServiceContext, ruleId: string) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'assignmentRule.manage');
  return ctx.db.$transaction(async (tx) => {
    const active = await tx.assignmentRule.count({ where: { orgId: ctx.orgId } });
    if (active <= 1) throw new DomainError('INVALID_STATE', 'Phải giữ ít nhất một luật chia');
    const r = await tx.assignmentRule.findFirst({ where: { id: ruleId, orgId: ctx.orgId } });
    if (!r) throw notFound('luật chia');
    // History keeps pointing at the rule id; detach so the row can go.
    await tx.leadAssignment.updateMany({ where: { ruleId: r.id }, data: { ruleId: null } });
    await tx.assignmentRule.delete({ where: { id: r.id } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'assignmentRule.delete', entityType: 'AssignmentRule', entityId: r.id, before: { name: r.name }, ip: ctx.ip });
  });
}

/** Sets evaluation order: first id = highest priority. */
export async function reorderRules(ctx: ServiceContext, orderedIds: string[]) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'assignmentRule.manage');
  return ctx.db.$transaction(async (tx) => {
    const rules = await tx.assignmentRule.findMany({ where: { orgId: ctx.orgId }, select: { id: true } });
    if (rules.length !== orderedIds.length || !rules.every((r) => orderedIds.includes(r.id))) {
      throw new DomainError('VALIDATION_ERROR', 'Danh sách luật không khớp');
    }
    for (const [i, id] of orderedIds.entries()) await tx.assignmentRule.update({ where: { id }, data: { priority: (i + 1) * 10 } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'assignmentRule.reorder', entityType: 'AssignmentRule', entityId: '*', after: { order: orderedIds }, ip: ctx.ip });
  });
}

// ---------- holidays ----------

export const HolidayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(1).max(120),
});

export async function addHoliday(ctx: ServiceContext, raw: z.input<typeof HolidayInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'settings.manage');
  const input = HolidayInput.parse(raw);
  const date = new Date(`${input.date}T00:00:00Z`);
  const existing = await ctx.db.holiday.findUnique({ where: { orgId_date: { orgId: ctx.orgId, date } } });
  if (existing) throw new DomainError('CONFLICT', 'Ngày này đã có trong danh sách');
  const h = await ctx.db.holiday.create({ data: { orgId: ctx.orgId, date, name: input.name } });
  await recordAudit(ctx.db, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'holiday.create', entityType: 'Holiday', entityId: h.id, after: input, ip: ctx.ip });
  return h;
}

export async function deleteHoliday(ctx: ServiceContext, id: string) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'settings.manage');
  const h = await ctx.db.holiday.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!h) throw notFound('ngày lễ');
  await ctx.db.holiday.delete({ where: { id } });
  await recordAudit(ctx.db, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'holiday.delete', entityType: 'Holiday', entityId: id, before: { date: h.date.toISOString().slice(0, 10), name: h.name }, ip: ctx.ip });
}

/** Owner confirms the holiday list of a year (SPEC 6.1 "nhắc Owner xác nhận lại"). */
export async function confirmHolidayYear(ctx: ServiceContext, year: number) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'settings.manage');
  const years = await getSetting(ctx.db, ctx.orgId, 'calendar.holidaysConfirmedYears');
  if (!years.includes(year)) await setSetting(ctx.db, ctx.orgId, 'calendar.holidaysConfirmedYears', [...years, year].sort());
  await recordAudit(ctx.db, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'holiday.confirm_year', entityType: 'Setting', entityId: 'calendar.holidaysConfirmedYears', after: { year }, ip: ctx.ip });
}

// ---------- API keys (website form) ----------

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

export async function createApiKey(ctx: ServiceContext, input: { name: string; source: 'WEBSITE_WHOLESALE_FORM' | 'WEBSITE_AGENT_FORM' }) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'integration.manage');
  const key = `mk_live_${randomBytes(24).toString('base64url')}`;
  const row = await ctx.db.apiKey.create({ data: { orgId: ctx.orgId, name: input.name.trim().slice(0, 120), source: input.source, hash: hashApiKey(key) } });
  await recordAudit(ctx.db, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'apiKey.create', entityType: 'ApiKey', entityId: row.id, after: { name: row.name, source: row.source }, ip: ctx.ip });
  return { id: row.id, key }; // shown once
}

export async function revokeApiKey(ctx: ServiceContext, id: string) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'integration.manage');
  const row = await ctx.db.apiKey.findFirst({ where: { id, orgId: ctx.orgId, revokedAt: null } });
  if (!row) throw notFound('API key');
  await ctx.db.apiKey.update({ where: { id }, data: { revokedAt: ctx.now() } });
  await recordAudit(ctx.db, { orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'apiKey.revoke', entityType: 'ApiKey', entityId: id, ip: ctx.ip });
}

export async function findApiKey(db: ServiceContext['db'], key: string) {
  if (!key) return null;
  const row = await db.apiKey.findUnique({ where: { hash: hashApiKey(key) } });
  return row && !row.revokedAt ? row : null;
}
