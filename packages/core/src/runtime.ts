// Runtime wiring shared by apps/web and apps/worker: queue names, the Redis/BullMQ implementation
// of `Effects`, and job payload types. Import from "@michio/core/runtime" (server-only).
import { type JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Actor } from './context';
import type { DomainEvent, Effects } from './effects';
import type { ImportAssign, ImportRow } from './imports/customers';

// Queue names (SPEC §9).
export const QUEUES = {
  channelInbound: 'channel-inbound',
  channelOutbound: 'channel-outbound',
  zaloBotInbound: 'zalo-bot-inbound',
  zaloBotNotify: 'zalo-bot-notify',
  assignment: 'assignment',
  slaCheck: 'sla-check',
  import: 'import',
  system: 'system', // cron-style jobs (sweepers, digests, syncs)
} as const;

/** Redis pub/sub channel for SSE (SPEC 4.1 "Server-Sent Events qua Redis pub/sub"). */
export const EVENTS_CHANNEL = 'msh:events';

/** Warn the assignee this long before the accept deadline (SPEC 5.5 "Còn 3 phút"). */
export const EXPIRY_WARNING_MS = 3 * 60_000;

export interface SlaJobData {
  assignmentId: string;
}

export interface ImportJobData {
  actor: Actor;
  rows: ImportRow[];
  assign: ImportAssign;
  fileName?: string;
}

const DEFAULT_JOB: JobsOptions = { removeOnComplete: { age: 7 * 86_400, count: 5_000 }, removeOnFail: { age: 30 * 86_400 }, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } };

export interface RuntimeEffects extends Effects {
  queues: { slaCheck: Queue; import: Queue };
  close(): Promise<void>;
}

/**
 * `connection` must be created with `maxRetriesPerRequest: null` (BullMQ requirement).
 * Delayed SLA jobs use deterministic ids, so re-scheduling the same assignment is a no-op.
 */
export function createRuntimeEffects(connection: Redis): RuntimeEffects {
  const slaCheck = new Queue<SlaJobData>(QUEUES.slaCheck, { connection, defaultJobOptions: DEFAULT_JOB });
  const importQueue = new Queue<ImportJobData>(QUEUES.import, { connection, defaultJobOptions: { ...DEFAULT_JOB, attempts: 1 } });
  return {
    queues: { slaCheck, import: importQueue },
    async publish(event: DomainEvent) {
      await connection.publish(EVENTS_CHANNEL, JSON.stringify(event));
    },
    async scheduleSlaCheck(assignmentId: string, deadline: Date) {
      const now = Date.now();
      // +1s so the job never runs before the deadline it checks.
      await slaCheck.add('check', { assignmentId }, { jobId: `check-${assignmentId}`, delay: Math.max(0, deadline.getTime() - now + 1_000) });
      const warnAt = deadline.getTime() - EXPIRY_WARNING_MS;
      if (warnAt > now + 30_000) await slaCheck.add('warn', { assignmentId }, { jobId: `warn-${assignmentId}`, delay: warnAt - now });
    },
    async close() {
      await Promise.all([slaCheck.close(), importQueue.close()]);
    },
  };
}
