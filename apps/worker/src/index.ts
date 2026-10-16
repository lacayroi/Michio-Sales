import { expireAssignment, releaseHeldLeads, runCustomerImport, sweepSla, warnExpiring } from '@michio/core';
import { createRuntimeEffects, type ImportJobData, QUEUES, type SlaJobData } from '@michio/core/runtime';
import { prisma } from '@michio/db';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';

const log = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const effects = createRuntimeEffects(connection);
const systemQueue = new Queue(QUEUES.system, { connection });

const TZ = 'Asia/Ho_Chi_Minh';

// SPEC §9: every job is idempotent; logs carry jobId and the entity id.
const workers = [
  new Worker<SlaJobData>(
    QUEUES.slaCheck,
    async (job) => {
      const { assignmentId } = job.data;
      if (job.name === 'warn') return { warned: await warnExpiring(prisma, effects, assignmentId) };
      const res = await expireAssignment(prisma, effects, assignmentId);
      if (!res.skipped) log.info({ jobId: job.id, assignmentId, outcome: res.outcome?.kind }, 'assignment expired');
      return { skipped: res.skipped };
    },
    { connection, concurrency: 5 },
  ),

  new Worker(
    QUEUES.system,
    async (job) => {
      switch (job.name) {
        case 'heartbeat':
          await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 180);
          return;
        case 'sla-sweeper': {
          const res = await sweepSla(prisma, effects);
          if (res.expired || res.contactOverdue) log.info({ jobId: job.id, ...res }, 'sla sweep');
          return res;
        }
        case 'out-of-hours-release': {
          const orgs = await prisma.organization.findMany({ select: { id: true } });
          let released = 0;
          for (const o of orgs) released += (await releaseHeldLeads(prisma, effects, o.id)).released;
          if (released) log.info({ jobId: job.id, released }, 'held leads released');
          return { released };
        }
        default:
          log.warn({ jobId: job.id, name: job.name }, 'unknown system job');
      }
    },
    { connection },
  ),

  new Worker<ImportJobData>(
    QUEUES.import,
    async (job: Job<ImportJobData>) => {
      const { actor, rows, assign } = job.data;
      log.info({ jobId: job.id, rows: rows.length, mode: assign.mode }, 'import started');
      const result = await runCustomerImport(prisma, effects, actor, rows, assign, (done, total) =>
        job.updateProgress({ done, total }),
      );
      log.info({ jobId: job.id, created: result.created, updated: result.updated, failed: result.failed.length }, 'import done');
      return result;
    },
    { connection, concurrency: 1 },
  ),
];

for (const w of workers) w.on('failed', (job, err) => log.error({ queue: w.name, jobId: job?.id, err }, 'job failed'));

await systemQueue.upsertJobScheduler('heartbeat', { every: 60_000 }, { name: 'heartbeat' });
await systemQueue.upsertJobScheduler('sla-sweeper', { every: 60_000 }, { name: 'sla-sweeper' });
// 08:00 T2–T7 (holidays are skipped inside releaseHeldLeads).
await systemQueue.upsertJobScheduler('out-of-hours-release', { pattern: '0 8 * * 1-6', tz: TZ }, { name: 'out-of-hours-release' });
await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 180);
log.info('worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  await Promise.all(workers.map((w) => w.close()));
  await systemQueue.close();
  await effects.close();
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
