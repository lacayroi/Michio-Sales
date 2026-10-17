// `pnpm replay:webhook --id <WebhookEvent id>` (SPEC 11.4): re-queue a stored webhook event.
// Processing is idempotent (unique message ids / leadgen ids), so replaying a processed event is safe.
import { type ChannelInboundJob, INBOUND_JOB, QUEUES, type ZaloBotInboundJob } from '@michio/core';
import { prisma } from '@michio/db';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const args = process.argv.slice(2);
const id = args[args.indexOf('--id') + 1];
if (!args.includes('--id') || !id) {
  console.error('Usage: pnpm replay:webhook --id <WebhookEvent id>');
  process.exit(1);
}

const ev = await prisma.webhookEvent.findUnique({ where: { id } });
if (!ev) {
  console.error(`WebhookEvent ${id} not found`);
  process.exit(1);
}
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
// Back to RECEIVED so the processor runs again (FAILED events are the usual reason to replay).
await prisma.webhookEvent.update({ where: { id }, data: { status: 'RECEIVED', error: null } });
const jobId = `replay-${id}-${Date.now()}`;
if (ev.source === 'facebook') {
  const q = new Queue<ChannelInboundJob>(QUEUES.channelInbound, { connection });
  await q.add('event', { webhookEventId: id }, { ...INBOUND_JOB, jobId });
  await q.close();
} else if (ev.source === 'zalo-bot') {
  const q = new Queue<ZaloBotInboundJob>(QUEUES.zaloBotInbound, { connection });
  await q.add('message', { webhookEventId: id }, { jobId, removeOnComplete: 5000, removeOnFail: 5000 });
  await q.close();
} else {
  console.error(`No replay handler for source "${ev.source}"`);
  process.exit(1);
}
console.log(`Queued ${ev.source} event ${id} (${ev.eventKey}) for replay`);
await connection.quit();
await prisma.$disconnect();
