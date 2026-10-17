// Quick stage change from the inbox card / lead page (SPEC 6.4 "sửa nhanh giai đoạn"; same service as TRANGTHAI).
import { changeLeadStage } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

const Body = z.object({ stage: z.enum(['DA_LIEN_HE', 'TU_VAN', 'BAO_GIA', 'CHOT', 'THUA']), note: z.string().trim().max(500).optional() });

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const { stage, note } = await readJson(req, Body);
  const r = await changeLeadStage(ctx, params.id, stage, note);
  return { stage: r.stage.code, dealId: r.deal.id, lostReason: r.lostReason };
});
