import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { QUEUES } from './queues';

const log = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

const systemQueue = new Queue(QUEUES.system, { connection });

// M0: heartbeat only, so /health can report worker liveness. Real processors arrive in M1+.
const worker = new Worker(
  QUEUES.system,
  async (job) => {
    if (job.name === 'heartbeat') {
      await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 180);
      return;
    }
    log.warn({ jobId: job.id, name: job.name }, 'unknown system job');
  },
  { connection },
);

worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'job failed'));

await systemQueue.upsertJobScheduler('heartbeat', { every: 60_000 }, { name: 'heartbeat' });
await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 180);
log.info('worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  await worker.close();
  await systemQueue.close();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
