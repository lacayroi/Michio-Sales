// POST /transfers (S14, SPEC 6.10): validated now, executed by the worker's transfer job.
import { QUEUES, type TransferJobData, TransferInput, validateTransfer } from '@michio/core';
import { readJson, route } from '@/lib/api';
import { queue } from '@/lib/services';

export const POST = route(async ({ req, ctx, user }) => {
  const input = await readJson(req, TransferInput);
  await validateTransfer(ctx, input);
  const job = await queue(QUEUES.transfer).add('transfer', { orgId: user.orgId, actorId: user.id, input } satisfies TransferJobData, { removeOnComplete: { age: 7 * 86_400 }, removeOnFail: { age: 7 * 86_400 } });
  return { id: job.id };
}, { status: 202 });
