import { assertAuthorized } from '@michio/auth';
import { type ImportJobData, type ImportSummary, QUEUES } from '@michio/core';
import { HttpError, route } from '@/lib/api';
import { queue } from '@/lib/services';

export const GET = route<{ id: string }>(async ({ ctx, user, params }) => {
  assertAuthorized(user, 'import.manage');
  const job = await queue(QUEUES.import).getJob(params.id);
  if (!job || (job.data as ImportJobData).orgId !== ctx.orgId) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy lượt nhập');
  const state = await job.getState();
  return {
    id: job.id,
    state, // waiting | active | completed | failed
    progress: job.progress,
    fileName: (job.data as ImportJobData).fileName,
    result: state === 'completed' ? (job.returnvalue as ImportSummary) : null,
    error: state === 'failed' ? job.failedReason : null,
  };
});
