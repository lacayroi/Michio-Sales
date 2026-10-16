// Assignment rule administration + "Thử luật" simulation (SPEC 6.3.2, 6.12, §8 /assignment-rules).
import { assertAuthorized } from '@michio/auth';
import type { AssignmentMethod, FallbackAction, Prisma } from '@michio/db';
import { addBusinessMinutes, isBusinessTime, normalizeVnPhone, type OrderBandCode, priorityForBand } from '@michio/shared';
import { recordAudit } from '../audit';
import type { Actor, Db } from '../context';
import { NotFoundError, ValidationError } from '../errors';
import { findDuplicateCustomer } from '../leads/intake';
import { loadCalendar, loadSettings } from '../settings';
import { defaultTargets, INELIGIBLE_LABELS, type IneligibleReason, ineligibleReason, loadCandidateFacts } from './candidates';
import { DEFAULT_SLA } from './engine';
import { pickLeastLoaded, pickRoundRobin, pickWeighted, type WeightState } from './pick';
import { matchesRule, RuleConditions, type RoutableLead } from './rules';

export const ROUTING_METHODS = ['ROUND_ROBIN', 'WEIGHTED', 'LEAST_LOADED', 'MANUAL'] as const;

export interface RuleInput {
  name: string;
  priority?: number;
  isActive?: boolean;
  conditions?: unknown;
  targetUserIds?: string[];
  method: (typeof ROUTING_METHODS)[number];
  autoAccept?: boolean;
  acceptSlaMinutes?: number;
  hotAcceptSlaMinutes?: number;
  firstContactSlaMinutes?: number;
  maxReassign?: number;
  fallback?: FallbackAction;
  /** WEIGHTED only: {userId: weight} */
  weights?: Record<string, number>;
}

export async function listRules(db: Db, actor: Actor) {
  assertAuthorized(actor.user!, 'assignmentRule.manage');
  return db.assignmentRule.findMany({ where: { orgId: actor.orgId }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
}

function ruleData(input: Partial<RuleInput>): Prisma.AssignmentRuleUncheckedUpdateInput {
  const data: Prisma.AssignmentRuleUncheckedUpdateInput = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ValidationError('Cần tên luật');
    data.name = input.name.trim();
  }
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.conditions !== undefined) {
    const parsed = RuleConditions.safeParse(input.conditions ?? {});
    if (!parsed.success) throw new ValidationError('Điều kiện luật không hợp lệ', parsed.error.issues);
    data.conditions = parsed.data as Prisma.InputJsonValue;
  }
  if (input.targetUserIds !== undefined) data.targetUserIds = [...new Set(input.targetUserIds)];
  if (input.method !== undefined) data.method = input.method as AssignmentMethod;
  if (input.autoAccept !== undefined) data.autoAccept = input.autoAccept;
  const minutes = (v: number | undefined, label: string) => {
    if (v === undefined) return undefined;
    if (!Number.isInteger(v) || v < 1 || v > 24 * 60) throw new ValidationError(`${label} phải từ 1 đến 1440 phút`);
    return v;
  };
  data.acceptSlaMinutes = minutes(input.acceptSlaMinutes, 'Thời hạn nhận');
  data.hotAcceptSlaMinutes = minutes(input.hotAcceptSlaMinutes, 'Thời hạn nhận lead HOT');
  data.firstContactSlaMinutes = minutes(input.firstContactSlaMinutes, 'Thời hạn liên hệ đầu tiên');
  if (input.maxReassign !== undefined) {
    if (input.maxReassign < 0 || input.maxReassign > 20) throw new ValidationError('Số lần thu hồi tối đa từ 0 đến 20');
    data.maxReassign = input.maxReassign;
  }
  if (input.fallback !== undefined) data.fallback = input.fallback;
  if (input.weights !== undefined) data.weightState = { weights: input.weights, current: {} } satisfies WeightState as unknown as Prisma.InputJsonValue;
  return data;
}

async function assertTargets(db: Db, orgId: string, ids: string[] | undefined) {
  if (!ids?.length) return;
  const n = await db.user.count({ where: { orgId, id: { in: ids }, deletedAt: null } });
  if (n !== new Set(ids).size) throw new ValidationError('Danh sách người nhận có người không hợp lệ');
}

export async function createRule(db: Db, actor: Actor, input: RuleInput) {
  assertAuthorized(actor.user!, 'assignmentRule.manage');
  await assertTargets(db, actor.orgId, input.targetUserIds);
  const last = await db.assignmentRule.aggregate({ where: { orgId: actor.orgId, priority: { lt: 1000 } }, _max: { priority: true } });
  const data = ruleData(input) as Prisma.AssignmentRuleUncheckedCreateInput;
  return db.$transaction(async (tx) => {
    const rule = await tx.assignmentRule.create({
      data: { ...data, orgId: actor.orgId, name: input.name.trim(), method: input.method, conditions: data.conditions ?? {}, priority: input.priority ?? (last._max.priority ?? 0) + 10 },
    });
    await recordAudit(tx, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'assignmentRule.create', entityType: 'AssignmentRule', entityId: rule.id, after: rule as unknown as Prisma.InputJsonValue, ip: actor.ip });
    return rule;
  });
}

export async function updateRule(db: Db, actor: Actor, id: string, input: Partial<RuleInput>) {
  assertAuthorized(actor.user!, 'assignmentRule.manage');
  const rule = await db.assignmentRule.findFirst({ where: { id, orgId: actor.orgId } });
  if (!rule) throw new NotFoundError('Không tìm thấy luật');
  await assertTargets(db, actor.orgId, input.targetUserIds);
  return db.$transaction(async (tx) => {
    const updated = await tx.assignmentRule.update({ where: { id }, data: ruleData(input) });
    await recordAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.user!.id,
      via: actor.via,
      action: 'assignmentRule.update',
      entityType: 'AssignmentRule',
      entityId: id,
      before: rule as unknown as Prisma.InputJsonValue,
      after: updated as unknown as Prisma.InputJsonValue,
      ip: actor.ip,
    });
    return updated;
  });
}

export async function deleteRule(db: Db, actor: Actor, id: string) {
  assertAuthorized(actor.user!, 'assignmentRule.manage');
  const rule = await db.assignmentRule.findFirst({ where: { id, orgId: actor.orgId } });
  if (!rule) throw new NotFoundError('Không tìm thấy luật');
  const remaining = await db.assignmentRule.count({ where: { orgId: actor.orgId, isActive: true, id: { not: id } } });
  if (remaining === 0) throw new ValidationError('Cần giữ ít nhất 1 luật đang bật');
  // Assignments keep their history, so a used rule is deactivated rather than deleted.
  const used = await db.leadAssignment.count({ where: { ruleId: id } });
  await db.$transaction([
    used ? db.assignmentRule.update({ where: { id }, data: { isActive: false } }) : db.assignmentRule.delete({ where: { id } }),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: used ? 'assignmentRule.deactivate' : 'assignmentRule.delete', entityType: 'AssignmentRule', entityId: id, before: rule as unknown as Prisma.InputJsonValue, ip: actor.ip }),
  ]);
}

/** Persist a new evaluation order: ids[0] is checked first. */
export async function reorderRules(db: Db, actor: Actor, ids: string[]) {
  assertAuthorized(actor.user!, 'assignmentRule.manage');
  const rules = await db.assignmentRule.findMany({ where: { orgId: actor.orgId }, select: { id: true, priority: true } });
  if (rules.length !== ids.length || !rules.every((r) => ids.includes(r.id))) throw new ValidationError('Danh sách luật không khớp');
  await db.$transaction([
    ...ids.map((id, i) => db.assignmentRule.update({ where: { id }, data: { priority: (i + 1) * 10 } })),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'assignmentRule.reorder', entityType: 'AssignmentRule', entityId: ids[0] ?? '-', before: rules, after: ids, ip: actor.ip }),
  ]);
}

export interface SimulationInput extends Partial<RoutableLead> {
  source: string;
  phone?: string | null;
  at?: Date;
}

export interface SimulationResult {
  path: 'CUSTOMER_OWNER' | 'RULE' | 'QUEUE' | 'HOLD';
  rule: { id: string; name: string; method: string } | null;
  matchedRules: { id: string; name: string }[];
  candidates: { id: string; fullName: string; openLeads: number; maxOpenLeads: number; eligible: boolean; reason: string | null }[];
  picked: { id: string; fullName: string } | null;
  acceptDeadline: Date | null;
  explanation: string;
}

/** "Thử luật": which rule matches a fake lead and who would get it — without changing any state. */
export async function simulateAssignment(db: Db, actor: Actor, input: SimulationInput): Promise<SimulationResult> {
  assertAuthorized(actor.user!, 'assignmentRule.manage');
  const at = input.at ?? new Date();
  const settings = await loadSettings(db, actor.orgId);
  const calendar = await loadCalendar(db, actor.orgId, settings);
  const priority = input.priority ?? priorityForBand((input.expectedOrderBand ?? null) as OrderBandCode | null, settings['priority.byOrderBand']);
  const lead: RoutableLead = { ...input, priority };
  const rules = await db.assignmentRule.findMany({ where: { orgId: actor.orgId, isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  const matching = rules.filter((r) => matchesRule(r.conditions, lead, at));
  const matchedRules = matching.map((r) => ({ id: r.id, name: r.name }));
  const deadlineFor = (r: (typeof rules)[number] | undefined) =>
    addBusinessMinutes(calendar, at, priority === 'HOT' ? (r?.hotAcceptSlaMinutes ?? DEFAULT_SLA.hotAcceptSlaMinutes) : (r?.acceptSlaMinutes ?? DEFAULT_SLA.acceptSlaMinutes));

  const phone = input.phone ? normalizeVnPhone(input.phone) : null;
  if (phone && settings['assignment.keepCustomerOwner']) {
    const c = await findDuplicateCustomer(db, actor.orgId, { phone });
    if (c && c.orderCount > 0 && c.ownerId) {
      const owner = await db.user.findUnique({ where: { id: c.ownerId }, select: { id: true, fullName: true, status: true } });
      if (owner && owner.status !== 'INACTIVE') {
        return {
          path: 'CUSTOMER_OWNER',
          rule: null,
          matchedRules,
          candidates: [],
          picked: { id: owner.id, fullName: owner.fullName },
          acceptDeadline: deadlineFor(matching[0]),
          explanation: `Khách "${c.contactName}" đã mua hàng → giao thẳng cho sales phụ trách.`,
        };
      }
    }
  }

  for (const rule of matching) {
    if (rule.method === 'MANUAL') {
      return { path: 'QUEUE', rule: { id: rule.id, name: rule.name, method: rule.method }, matchedRules, candidates: [], picked: null, acceptDeadline: null, explanation: `Luật "${rule.name}" là giao tay → lead vào hàng chờ.` };
    }
    const targets = rule.targetUserIds.length ? rule.targetUserIds : await defaultTargets(db, actor.orgId);
    const facts = await loadCandidateFacts(db, actor.orgId, targets, at);
    const reasons = new Map<string, IneligibleReason | null>(targets.map((id) => [id, facts.has(id) ? ineligibleReason(facts.get(id)!, new Set()) : 'NOT_FOUND']));
    const eligible = new Set(targets.filter((id) => reasons.get(id) === null));
    const pickedId =
      rule.method === 'WEIGHTED'
        ? pickWeighted(targets, rule.weightState as WeightState | null, eligible)?.userId
        : rule.method === 'LEAST_LOADED'
          ? pickLeastLoaded(targets, new Map([...facts].map(([id, f]) => [id, f.openLeads])), eligible)?.userId
          : pickRoundRobin(targets, rule.rrCursor, eligible)?.userId;
    const candidates = targets.map((id) => {
      const f = facts.get(id);
      const r = reasons.get(id) ?? null;
      return { id, fullName: f?.fullName ?? '(không rõ)', openLeads: f?.openLeads ?? 0, maxOpenLeads: f?.maxOpenLeads ?? 0, eligible: r === null, reason: r ? INELIGIBLE_LABELS[r] : null };
    });
    if (pickedId) {
      const picked = candidates.find((c) => c.id === pickedId)!;
      const held = settings['assignment.outOfHoursMode'] === 'HOLD' && !isBusinessTime(calendar, at);
      return {
        path: held ? 'HOLD' : 'RULE',
        rule: { id: rule.id, name: rule.name, method: rule.method },
        matchedRules,
        candidates,
        picked: { id: picked.id, fullName: picked.fullName },
        acceptDeadline: rule.autoAccept ? null : deadlineFor(rule),
        explanation: held
          ? `Ngoài giờ làm việc và đang bật chế độ giữ lead → lead sẽ được chia lúc mở cửa; theo lượt hiện tại sẽ vào ${picked.fullName}.`
          : `Luật "${rule.name}" khớp → ${picked.fullName} nhận lead.`,
      };
    }
    if (rule.fallback === 'QUEUE') {
      return { path: 'QUEUE', rule: { id: rule.id, name: rule.name, method: rule.method }, matchedRules, candidates, picked: null, acceptDeadline: null, explanation: `Luật "${rule.name}" khớp nhưng không còn ai nhận được → hàng chờ, báo Owner.` };
    }
  }
  return { path: 'QUEUE', rule: null, matchedRules, candidates: [], picked: null, acceptDeadline: null, explanation: matching.length ? 'Không còn sales nào nhận được → hàng chờ.' : 'Không có luật nào khớp → hàng chờ, báo Owner.' };
}
