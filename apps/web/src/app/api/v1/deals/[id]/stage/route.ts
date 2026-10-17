// Kanban drag (SPEC 6.5). `id` is a deal id, or `lead-<leadId>` for a working lead without a deal yet.
import { DealStageInput, moveDealStage } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const r = await moveDealStage(ctx, params.id, await readJson(req, DealStageInput));
  return { dealId: r.deal.id, stage: r.stage.code };
});
