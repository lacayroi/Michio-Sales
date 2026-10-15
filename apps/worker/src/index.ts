import {
  createRedisEffects, expireAssignment, type ImportJobData, QUEUES, releaseHeldLeads, runCustomerImport, type ServiceContext, sweepSla,
} from '@michio/core';
import { prisma } from '@michio/db';
import { createServer } from 'node:http';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';

const log = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const effects = createRedisEffects(connection);

const systemCtx = (orgId: string): ServiceContext => ({ db: prisma, effects, now: () => new Date(), actor: null, orgId, via: 'SYSTEM' });
const orgIds = async () => (await prisma.organization.findMany({ select: { id: true } })).map((o) => o.id);

// Delayed per-assignment check at its accept deadline (SPEC 6.3.4 onSlaCheck).
const slaWorker = new Worker<{ assignmentId: string }>(
  QUEUES.slaCheck,
  async (job) => {
    const a = await prisma.leadAssignment.findUnique({ where: { id: job.data.assignmentId }, select: { lead: { select: { orgId: true } } } });
    if (!a) return { status: 'SKIPPED' };
    const out = await expireAssignment(systemCtx(a.lead.orgId), job.data.assignmentId);
    log.info({ jobId: job.id, assignmentId: job.data.assignmentId, status: out.status }, 'sla-check');
    return out;
  },
  { connection, concurrency: 5 },
);

const systemQueue = new Queue(QUEUES.system, { connection });
const systemWorker = new Worker(
  QUEUES.system,
  async (job) => {
    switch (job.name) {
      case 'heartbeat':
        await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 180);
        return;
      case 'sla-sweeper': // safety net when delayed jobs were lost (SPEC 6.3.4)
        for (const orgId of await orgIds()) {
          const r = await sweepSla(systemCtx(orgId));
          if (r.expired || r.warned) log.info({ jobId: job.id, orgId, ...r }, 'sla-sweeper');
        }
        return;
      case 'out-of-hours-release': // 08:00 T2–T7; only finds leads held by outOfHoursMode = HOLD
        for (const orgId of await orgIds()) {
          const r = await releaseHeldLeads(systemCtx(orgId));
          if (r.length) log.info({ jobId: job.id, orgId, released: r.length }, 'out-of-hours-release');
        }
        return;
      default:
        log.warn({ jobId: job.id, name: job.name }, 'unknown system job');
    }
  },
  { connection },
);

const importWorker = new Worker<ImportJobData>(
  QUEUES.import,
  async (job) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: job.data.actorId } });
    const ctx: ServiceContext = { ...systemCtx(job.data.orgId), actor, via: 'WEB' };
    const summary = await runCustomerImport(ctx, job.data.rows, job.data.options, (done, total) => job.updateProgress({ done, total }));
    log.info({ jobId: job.id, orgId: job.data.orgId, created: summary.created, updated: summary.updated, failed: summary.failed.length }, 'import done');
    return summary;
  },
  { connection, concurrency: 1 },
);

for (const w of [slaWorker, systemWorker, importWorker]) {
  w.on('failed', (job, err) => log.error({ queue: w.name, jobId: job?.id, err }, 'job failed'));
}

await systemQueue.upsertJobScheduler('heartbeat', { every: 60_000 }, { name: 'heartbeat' });
await systemQueue.upsertJobScheduler('sla-sweeper', { every: 60_000 }, { name: 'sla-sweeper' });
await systemQueue.upsertJobScheduler('out-of-hours-release', { pattern: '0 8 * * 1-6', tz: 'Asia/Ho_Chi_Minh' }, { name: 'out-of-hours-release' });
await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 180);
log.info('worker started');

// Optional liveness endpoint for orchestration (Docker healthcheck, Playwright webServer).
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
const health = healthPort
  ? createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
    }).listen(healthPort)
  : null;

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  health?.close();
  await Promise.all([slaWorker.close(), systemWorker.close(), importWorker.close()]);
  await systemQueue.close();
  await effects.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
