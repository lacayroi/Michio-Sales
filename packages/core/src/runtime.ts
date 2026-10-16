// Production Effects: BullMQ for delayed SLA checks, Redis pub/sub for SSE (SPEC §9, §8).
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Effects } from './context';
import { type AppEvent, eventChannel } from './events';

export const QUEUES = {
  slaCheck: 'sla-check',
  system: 'system', // repeatable jobs: heartbeat, sla-sweeper, out-of-hours-release
  import: 'import',
} as const;

export interface ImportJobData {
  orgId: string;
  actorId: string;
  rows: import('./import').ImportRow[];
  options: import('./import').ImportOptions;
  fileName: string;
}

export function createRedisEffects(connection: Redis): Effects & { slaQueue: Queue; close(): Promise<void> } {
  const slaQueue = new Queue(QUEUES.slaCheck, { connection });
  return {
    slaQueue,
    async scheduleSlaCheck(assignmentId, at) {
      await slaQueue.add(
        'check',
        { assignmentId },
        // jobId makes re-scheduling idempotent; BullMQ ids may not contain ':'.
        { jobId: `sla-${assignmentId}`, delay: Math.max(0, at.getTime() - Date.now()), removeOnComplete: 1000, removeOnFail: 5000, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    },
    async publish(event: AppEvent) {
      await connection.publish(eventChannel(event.orgId), JSON.stringify(event));
    },
    async close() {
      await slaQueue.close();
    },
  };
}
