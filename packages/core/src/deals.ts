// Pipeline Kanban (S7, SPEC 6.5). Deals are created on the first stage change of a lead; leads being
// worked without a deal yet show in the first column ("Mới") so the board covers every open lead.
import { assertAuthorized, authorize, scopeFilter } from '@michio/auth';
import type { Prisma } from '@michio/db';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { DomainError, notFound } from './errors';
import { changeLeadStage } from './lead-stage';

const DAY = 86_400_000;

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

export const PipelineFilters = z.object({
  ownerId: z.string().optional(),
  /** Closed deals stay visible this many days (won/lost columns). */
  closedDays: z.coerce.number().int().min(0).max(365).default(30),
  q: z.string().trim().max(100).optional(),
});

export interface PipelineCard {
  key: string;
  dealId: string | null;
  leadId: string;
  leadCode: number;
  title: string;
  customerId: string;
  customerName: string;
  ownerId: string | null;
  ownerName: string | null;
  amount: number;
  priority: string;
  updatedAt: Date;
  closedAt: Date | null;
  lostReason: string | null;
}

export async function getPipeline(ctx: ServiceContext, raw: z.input<typeof PipelineFilters> = {}) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'deal.view');
  const f = PipelineFilters.parse(raw);
  const since = new Date(ctx.now().getTime() - f.closedDays * DAY);
  const search: Prisma.CustomerWhereInput | undefined = f.q
    ? { OR: [{ contactName: { contains: f.q, mode: 'insensitive' } }, { shopName: { contains: f.q, mode: 'insensitive' } }] }
    : undefined;
  const [stages, deals, bareLeads, quoteTotals] = await Promise.all([
    ctx.db.pipelineStage.findMany({ where: { orgId: ctx.orgId }, orderBy: { order: 'asc' } }),
    ctx.db.deal.findMany({
      where: { ...scopeFilter(actor, 'deal'), deletedAt: null, OR: [{ closedAt: null }, { closedAt: { gte: since } }], ...(f.ownerId ? { ownerId: f.ownerId } : {}), ...(search ? { customer: search } : {}) },
      include: { customer: { select: { contactName: true, shopName: true } }, owner: { select: { fullName: true } }, lead: { select: { code: true, priority: true } }, lostReason: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    ctx.db.lead.findMany({
      where: { ...scopeFilter(actor, 'lead'), deletedAt: null, status: 'IN_PROGRESS', deals: { none: { closedAt: null, deletedAt: null } }, ...(f.ownerId ? { ownerId: f.ownerId } : {}), ...(search ? { customer: search } : {}) },
      include: { customer: { select: { contactName: true, shopName: true } }, owner: { select: { fullName: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    }),
    ctx.db.quote.groupBy({ by: ['dealId'], where: { orgId: ctx.orgId, dealId: { not: null }, status: { in: ['SENT', 'ACCEPTED'] } }, _max: { total: true } }),
  ]);
  const quoted = new Map(quoteTotals.map((q) => [q.dealId, Number(q._max.total ?? 0)]));
  const first = stages[0];
  const columns = stages.map((s) => ({ id: s.id, code: s.code, name: s.name, probability: s.probability, isWon: s.isWon, isLost: s.isLost, cards: [] as PipelineCard[], amount: 0 }));
  for (const d of deals) {
    const col = columns.find((c) => c.id === d.stageId);
    if (!col) continue;
    const amount = quoted.get(d.id) ?? Number(d.expectedAmount);
    col.cards.push({
      key: d.id, dealId: d.id, leadId: d.leadId, leadCode: d.lead.code, title: d.title, customerId: d.customerId, customerName: d.customer.shopName ?? d.customer.contactName,
      ownerId: d.ownerId, ownerName: d.owner.fullName, amount, priority: d.lead.priority, updatedAt: d.updatedAt, closedAt: d.closedAt, lostReason: d.lostReason?.name ?? null,
    });
    col.amount += amount;
  }
  if (first) {
    const col = columns[0]!;
    for (const l of bareLeads) {
      col.cards.push({
        key: `lead-${l.id}`, dealId: null, leadId: l.id, leadCode: l.code, title: l.customer.shopName ?? l.customer.contactName, customerId: l.customerId,
        customerName: l.customer.shopName ?? l.customer.contactName, ownerId: l.ownerId, ownerName: l.owner?.fullName ?? null, amount: 0, priority: l.priority,
        updatedAt: l.updatedAt, closedAt: null, lostReason: null,
      });
    }
  }
  const lostReasons = await ctx.db.lostReason.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true } });
  return { columns, lostReasons };
}

export const DealStageInput = z.object({
  stage: z.enum(['MOI', 'DA_LIEN_HE', 'TU_VAN', 'BAO_GIA', 'CHOT', 'THUA']),
  lostReasonId: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});

/** POST /deals/:id/stage (Kanban drag). `lead-<id>` keys move a lead that has no deal yet. */
export async function moveDealStage(ctx: ServiceContext, dealOrLeadKey: string, raw: z.input<typeof DealStageInput>) {
  const actor = actorOf(ctx);
  const input = DealStageInput.parse(raw);
  if (input.stage === 'THUA' && !input.lostReasonId) throw new DomainError('VALIDATION_ERROR', 'Chọn lý do không thành công', { lostReasonId: ['Bắt buộc'] });
  let leadId: string;
  if (dealOrLeadKey.startsWith('lead-')) {
    leadId = dealOrLeadKey.slice(5);
  } else {
    const deal = await ctx.db.deal.findFirst({ where: { id: dealOrLeadKey, orgId: ctx.orgId, deletedAt: null } });
    if (!deal || !authorize(actor, 'deal.view', deal)) throw notFound('cơ hội');
    if (deal.closedAt) throw new DomainError('INVALID_STATE', 'Cơ hội đã đóng');
    leadId = deal.leadId;
  }
  return changeLeadStage(ctx, leadId, input.stage, input.note ?? null, { lostReasonId: input.lostReasonId });
}
