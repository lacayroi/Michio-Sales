// Production Effects: BullMQ for delayed SLA checks and Zalo Bot delivery, Redis pub/sub for SSE (SPEC §9, §8).
import { createZaloBotHttpClient, createZaloBotMockClient, type ZaloBotClient } from '@michio/channels';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Effects } from './context';
import { type AppEvent, eventChannel } from './events';

export const QUEUES = {
  slaCheck: 'sla-check',
  system: 'system', // repeatable jobs: heartbeat, sla-sweeper, out-of-hours-release, task-reminder, daily-digest
  import: 'import',
  zaloBotInbound: 'zalo-bot-inbound',
  zaloBotNotify: 'zalo-bot-notify',
} as const;

export interface ImportJobData {
  orgId: string;
  actorId: string;
  rows: import('./import').ImportRow[];
  options: import('./import').ImportOptions;
  fileName: string;
}

export interface ZaloBotInboundJob {
  webhookEventId: string;
}

export interface ZaloBotNotifyJob {
  notificationId: string;
}

const NOTIFY_JOB = { removeOnComplete: 5000, removeOnFail: 5000, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } };

export function createRedisEffects(connection: Redis): Effects & { slaQueue: Queue; notifyQueue: Queue; close(): Promise<void> } {
  const slaQueue = new Queue(QUEUES.slaCheck, { connection });
  const notifyQueue = new Queue<ZaloBotNotifyJob>(QUEUES.zaloBotNotify, { connection });
  return {
    slaQueue,
    notifyQueue,
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
    async deliverNotifications(ids) {
      await notifyQueue.addBulk(ids.map((notificationId) => ({ name: 'deliver', data: { notificationId }, opts: { ...NOTIFY_JOB, jobId: `n-${notificationId}` } })));
    },
    async close() {
      await Promise.all([slaQueue.close(), notifyQueue.close()]);
    },
  };
}

/** Redis list the mock bot writes to; the demo simulator on /ho-so reads it (MOCK_INTEGRATIONS=true). */
export const MOCK_BOT_OUTBOX = 'mock:zalo-bot:outbox';
const MOCK_OUTBOX_MAX = 500;

export interface MockBotMessage {
  chatId: string;
  text: string;
  at: string;
  /** 'bot' = sent by the bot, 'user' = typed into the simulator */
  from?: 'bot' | 'user';
}

export async function pushMockBotMessage(connection: Redis, m: MockBotMessage) {
  await connection.multi().lpush(MOCK_BOT_OUTBOX, JSON.stringify(m)).ltrim(MOCK_BOT_OUTBOX, 0, MOCK_OUTBOX_MAX - 1).exec();
}

export async function readMockBotMessages(connection: Redis, chatId: string, limit = 50): Promise<MockBotMessage[]> {
  const raw = await connection.lrange(MOCK_BOT_OUTBOX, 0, MOCK_OUTBOX_MAX - 1);
  return raw
    .map((r) => JSON.parse(r) as MockBotMessage)
    .filter((m) => m.chatId === chatId)
    .slice(0, limit)
    .reverse();
}

export const isMockIntegrations = () => (process.env.MOCK_INTEGRATIONS ?? 'true') !== 'false';

/**
 * The one place that decides which Zalo Bot client runs: the real HTTP API when mocks are off and
 * a token is configured, the mock (Redis outbox for the simulator) when MOCK_INTEGRATIONS=true.
 */
export function createZaloBotClient(connection: Redis): ZaloBotClient | null {
  if (isMockIntegrations()) return createZaloBotMockClient({ push: (m) => pushMockBotMessage(connection, { ...m, from: 'bot' }) });
  const token = process.env.ZALO_BOT_TOKEN;
  return token ? createZaloBotHttpClient(token) : null; // live mode without a token: bot disabled
}
