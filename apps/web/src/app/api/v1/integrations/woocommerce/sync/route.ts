// "Đồng bộ ngay" — queued; the worker runs woo-product-sync.
import { assertAuthorized } from '@michio/auth';
import { QUEUES, type WooSyncJob } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';
import { queue } from '@/lib/services';

export const POST = route(async ({ req, user }) => {
  assertAuthorized(user, 'integration.manage');
  const { full } = await readJson(req, z.object({ full: z.boolean().default(false) }));
  const job = await queue(QUEUES.wooSync).add('sync', { orgId: user.orgId, full, actorId: user.id } satisfies WooSyncJob, { removeOnComplete: 100, removeOnFail: 500 });
  return { jobId: job.id };
}, { status: 202 });
