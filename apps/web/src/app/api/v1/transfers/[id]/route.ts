// GET /transfers/:id — progress and result of the transfer job.
import { assertAuthorized } from '@michio/auth';
import { QUEUES, type TransferJobData } from '@michio/core';
import { HttpError, route } from '@/lib/api';
import { queue } from '@/lib/services';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  assertAuthorized(user, 'transfer.manage');
  const job = await queue(QUEUES.transfer).getJob(params.id);
  if (!job || (job.data as TransferJobData).orgId !== user.orgId) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy');
  return { id: job.id, state: await job.getState(), progress: job.progress, result: job.returnvalue ?? null, error: job.failedReason ?? null };
});
