import { assertAuthorized } from '@michio/auth';
import type { ImportJobData } from '@michio/core/runtime';
import { NextResponse } from 'next/server';
import { apiError, authed } from '@/lib/api';
import { getEffects } from '@/lib/effects';

/** Import job status + progress (SPEC 6.2 "job nền có tiến độ"). */
export const GET = authed<{ id: string }>(async (_req, { user, params }) => {
  assertAuthorized(user, 'import.manage');
  const job = await getEffects().queues.import.getJob(params.id);
  const data = job?.data as ImportJobData | undefined;
  if (!job || data?.actor.orgId !== user.orgId) return apiError(404, 'NOT_FOUND', 'Không tìm thấy lượt import');
  return NextResponse.json({
    id: job.id,
    state: await job.getState(),
    progress: job.progress,
    total: data.rows.length,
    fileName: data.fileName ?? null,
    result: job.returnvalue ?? null,
    error: job.failedReason ?? null,
  });
});
