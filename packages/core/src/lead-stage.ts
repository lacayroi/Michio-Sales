// Moving a lead through the pipeline (SPEC 6.5). M2 exposes it to the bot (TRANGTHAI); the Kanban
// screen (M4) reuses the same service. One open deal per lead is created on first use.
import { assertAuthorized } from '@michio/auth';
import { recordAudit } from './audit';
import type { LeadStageCode } from './bot-commands';
import { Outbox, type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';
import { MANAGERS } from './events';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** Lost reason by fuzzy name ("gia cao" → "Giá cao hơn nguồn khác"), else "Khác". */
function matchLostReason(reasons: { id: string; name: string }[], text: string | null) {
  const t = text ? fold(text) : '';
  const hit = t ? reasons.find((r) => fold(r.name).includes(t) || t.includes(fold(r.name))) ?? reasons.find((r) => t.split(/\s+/).every((w) => fold(r.name).includes(w))) : undefined;
  return hit ?? reasons.find((r) => fold(r.name) === 'khac') ?? reasons[0];
}

export async function changeLeadStage(ctx: ServiceContext, leadId: string, stageCode: LeadStageCode | 'DA_LIEN_HE' | 'MOI', note?: string | null, opts: { lostReasonId?: string | null } = {}) {
  const actor = ctx.actor;
  if (!actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  const outbox = new Outbox(ctx.effects);
  const out = await ctx.db.$transaction(async (tx) => {
    const now = ctx.now();
    const lead = await tx.lead.findFirst({ where: { id: leadId, orgId: ctx.orgId, deletedAt: null }, include: { customer: { select: { contactName: true, shopName: true } } } });
    if (!lead) throw notFound('lead');
    assertAuthorized(actor, 'lead.update', lead);
    assertAuthorized(actor, 'deal.update', lead);
    if (lead.status !== 'IN_PROGRESS') {
      throw new DomainError('INVALID_STATE', lead.status === 'ASSIGNED' ? `Hãy nhận lead #${lead.code} trước (NHAN ${lead.code})` : `Lead #${lead.code} không ở trạng thái đang xử lý`);
    }
    const stage = await tx.pipelineStage.findFirst({ where: { orgId: ctx.orgId, code: stageCode } });
    if (!stage) throw new DomainError('VALIDATION_ERROR', `Chưa cấu hình giai đoạn ${stageCode}`);

    let deal = await tx.deal.findFirst({ where: { leadId, closedAt: null, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    const before = deal?.stageId ?? null;
    const closing = stage.isWon || stage.isLost;
    let lostReasonId: string | null = null;
    if (stage.isLost) {
      const reasons = await tx.lostReason.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true } });
      lostReasonId = (opts.lostReasonId && reasons.find((r) => r.id === opts.lostReasonId)?.id) || (matchLostReason(reasons, note ?? null)?.id ?? null);
    }
    const data = { stageId: stage.id, closedAt: closing ? now : null, lostReasonId, ownerId: lead.ownerId ?? actor.id };
    deal = deal
      ? await tx.deal.update({ where: { id: deal.id }, data })
      : await tx.deal.create({
          data: { orgId: ctx.orgId, leadId, customerId: lead.customerId, title: lead.customer.shopName ?? lead.customer.contactName, ...data, createdAt: now },
        });
    if (closing) {
      await tx.lead.update({ where: { id: leadId }, data: { status: stage.isWon ? 'WON' : 'LOST', lastActivityAt: now } });
    } else {
      await tx.lead.update({ where: { id: leadId }, data: { lastActivityAt: now } });
    }
    await tx.activity.create({
      data: { orgId: ctx.orgId, customerId: lead.customerId, leadId, userId: actor.id, type: 'STAGE_CHANGE', data: { from: before, to: stage.code, toName: stage.name, note: note ?? null, lostReasonId }, createdAt: now },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'deal.stage', entityType: 'Deal', entityId: deal.id,
      before: { stageId: before, leadStatus: lead.status }, after: { stage: stage.code, closedAt: data.closedAt?.toISOString() ?? null, lostReasonId }, ip: ctx.ip,
    });
    outbox.publish({ type: 'lead.updated', orgId: ctx.orgId, audience: { userIds: lead.ownerId ? [lead.ownerId] : [], roles: MANAGERS }, data: { leadId } });
    const reason = lostReasonId ? (await tx.lostReason.findUnique({ where: { id: lostReasonId } }))?.name ?? null : null;
    return { lead, stage, deal, lostReason: reason };
  }, TX_OPTIONS);
  await outbox.flush();
  return out;
}
