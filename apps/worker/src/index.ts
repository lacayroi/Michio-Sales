import { ZaloBotApiError } from '@michio/channels';
import {
  type BotRuntime,
  type ChannelInboundJob,
  type ChannelOutboundJob,
  checkFacebookTokens,
  createReorderReminders,
  notifyAtRisk,
  refreshLifecycles,
  runTransfer,
  type TransferJobData,
  warnStaleLeads,
  createS3Storage,
  createWooClientFor,
  expireQuotes,
  generateQuotePdf,
  type QuotePdfJob,
  sendQuotePdfToConversation,
  syncWooProducts,
  type WooSyncJob,
  wooAccount,
  createFacebookClient,
  deliverOutboundMessage,
  type MessengerRuntime,
  OUTBOUND_JOB,
  processFacebookEvent,
  createDailyDigests,
  createRedisEffects,
  createZaloBotClient,
  expireAssignment,
  getSettings,
  type ImportJobData,
  ingestZaloBotPayload,
  markBotDelivered,
  prepareBotDelivery,
  processZaloBotEvent,
  QUEUES,
  releaseHeldLeads,
  remindDueTasks,
  runCustomerImport,
  type ServiceContext,
  sweepSla,
  vnDateKey,
  warnExpiringAssignments,
  type ZaloBotInboundJob,
  type ZaloBotNotifyJob,
} from '@michio/core';
import { prisma } from '@michio/db';
import { renderQuotePdf } from '@michio/pdf';
import { createServer } from 'node:http';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';

const log = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const effects = createRedisEffects(connection);
const bot = createZaloBotClient(connection);
const appUrl = process.env.APP_URL ?? null;
const botRuntime: BotRuntime = { db: prisma, effects, now: () => new Date() };
const facebook = createFacebookClient(connection);
const storage = createS3Storage();
const messengerRuntime: MessengerRuntime | null = facebook ? { db: prisma, effects, now: () => new Date(), client: facebook, appId: process.env.FB_APP_ID ?? null } : null;

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

/** Morning digest: within two hours after `notify.dailyDigestTime` (default 08:00), once per org and day. */
async function maybeDailyDigest(orgId: string, now: Date) {
  const { 'notify.dailyDigestTime': at } = await getSettings(prisma, orgId, ['notify.dailyDigestTime']);
  const [hh = 8, mm = 0] = at.split(':').map(Number);
  const local = new Date(now.getTime() + 7 * 3600_000);
  const sinceStart = local.getUTCHours() * 60 + local.getUTCMinutes() - (hh * 60 + mm);
  if (sinceStart < 0 || sinceStart > 120) return;
  const flag = `digest-done:${orgId}:${vnDateKey(now)}`;
  if (await connection.exists(flag)) return;
  const r = await createDailyDigests(systemCtx(orgId));
  await connection.set(flag, '1', 'EX', 36 * 3600);
  log.info({ orgId, ...r }, 'daily-digest');
}

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
      case 'facebook-token-check': // daily: expired/revoked Page tokens → ERROR + alert Owner (SPEC §9)
        if (!messengerRuntime) return;
        for (const orgId of await orgIds()) {
          const r = await checkFacebookTokens(messengerRuntime, orgId);
          if (r.some((x) => !x.ok)) log.warn({ jobId: job.id, orgId, pages: r }, 'facebook-token-check');
        }
        return;
      case 'customer-lifecycle': // 01:00 daily: AT_RISK / DORMANT as time passes (SPEC 6.5, §9)
        for (const orgId of await orgIds()) {
          const r = await refreshLifecycles(systemCtx(orgId));
          await notifyAtRisk(systemCtx(orgId), r.atRisk);
          log.info({ jobId: job.id, orgId, checked: r.checked, changed: r.changed, atRisk: r.atRisk.length }, 'customer-lifecycle');
        }
        return;
      case 'reorder-reminder': // 07:30 T2–T7 (SPEC 6.8)
        for (const orgId of await orgIds()) {
          const r = await createReorderReminders(systemCtx(orgId));
          log.info({ jobId: job.id, orgId, ...r }, 'reorder-reminder');
        }
        return;
      case 'stale-lead': // hourly (SPEC 6.9)
        for (const orgId of await orgIds()) {
          const r = await warnStaleLeads(systemCtx(orgId));
          if (r.warned) log.info({ jobId: job.id, orgId, ...r }, 'stale-lead');
        }
        return;
      case 'quote-expiry': // hourly: SENT quotes past validUntil → EXPIRED (SPEC §9)
        for (const orgId of await orgIds()) {
          const r = await expireQuotes(systemCtx(orgId));
          if (r.expired) log.info({ jobId: job.id, orgId, ...r }, 'quote-expiry');
        }
        return;
      case 'woo-sync-tick': // hourly: run woo-product-sync when woo.syncIntervalHours has passed (SPEC 5.6)
        for (const orgId of await orgIds()) {
          const { 'woo.syncIntervalHours': hours } = await getSettings(prisma, orgId, ['woo.syncIntervalHours']);
          const state = (await wooAccount(prisma, orgId))?.meta as { lastSyncAt?: string } | null;
          const due = !state?.lastSyncAt || Date.now() - new Date(state.lastSyncAt).getTime() >= hours * 3600_000 - 5 * 60_000;
          if (due) await wooQueue.add('sync', { orgId } satisfies WooSyncJob, { jobId: `woo-${orgId}-${Math.floor(Date.now() / 3600_000)}`, removeOnComplete: 100, removeOnFail: 500 });
        }
        return;
      case 'task-reminder': // every minute: task reminders, "còn 3 phút" warnings, morning digest (SPEC §9)
        for (const orgId of await orgIds()) {
          const ctx = systemCtx(orgId);
          const tasks = await remindDueTasks(ctx);
          const expiring = await warnExpiringAssignments(ctx);
          if (tasks.reminded || expiring.warned) log.info({ jobId: job.id, orgId, ...tasks, ...expiring }, 'reminders');
          await maybeDailyDigest(orgId, new Date());
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

// ---- Zalo Bot (SPEC 5.5): commands in, notifications out — always through packages/channels ----
const inboundQueue = new Queue<ZaloBotInboundJob>(QUEUES.zaloBotInbound, { connection });
const notifyQueue = new Queue<ZaloBotNotifyJob>(QUEUES.zaloBotNotify, { connection });

const botInboundWorker = new Worker<ZaloBotInboundJob>(
  QUEUES.zaloBotInbound,
  async (job) => {
    if (!bot) throw new UnrecoverableError('Zalo Bot is not configured (ZALO_BOT_TOKEN / MOCK_INTEGRATIONS)');
    const r = await processZaloBotEvent(botRuntime, job.data.webhookEventId, (chatId, text) => bot.sendMessage(chatId, text));
    log.info({ jobId: job.id, eventId: job.data.webhookEventId, replies: r.skipped ? 0 : r.replies.length }, 'zalo-bot-inbound');
  },
  { connection, concurrency: 3 },
);

const botNotifyWorker = new Worker<ZaloBotNotifyJob>(
  QUEUES.zaloBotNotify,
  async (job) => {
    if (!bot) return { skipped: 'bot-disabled' };
    const now = new Date();
    const d = await prepareBotDelivery(prisma, job.data.notificationId, now, { appUrl });
    if (d.action === 'skip') return { skipped: d.reason };
    if (d.action === 'delay') {
      // Outside working hours: deliver at the next opening instead (SPEC 6.9).
      await notifyQueue.add('deliver', job.data, {
        jobId: `n-${job.data.notificationId}-at-${d.until.getTime()}`,
        delay: d.until.getTime() - now.getTime(),
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 5000,
        removeOnFail: 5000,
      });
      return { delayedUntil: d.until.toISOString() };
    }
    try {
      await bot.sendMessage(d.chatId, d.text);
    } catch (err) {
      if (err instanceof ZaloBotApiError && !err.retryable) throw new UnrecoverableError(err.message);
      throw err;
    }
    await markBotDelivered(prisma, job.data.notificationId, new Date());
    return { sent: true };
  },
  // Zalo documents no numeric quota (only error 429), so stay well below anything plausible.
  { connection, concurrency: 3, limiter: { max: 10, duration: 1000 } },
);

// ---- Facebook Messenger / Lead Ads (SPEC 5.2): every send goes through the MessageGateway ----
const channelInboundWorker = new Worker<ChannelInboundJob>(
  QUEUES.channelInbound,
  async (job) => {
    if (!messengerRuntime) throw new UnrecoverableError('Facebook is not configured (FB_APP_ID / FB_APP_SECRET / MOCK_INTEGRATIONS)');
    const r = await processFacebookEvent(messengerRuntime, job.data.webhookEventId);
    log.info({ jobId: job.id, eventId: job.data.webhookEventId, ...r }, 'channel-inbound');
  },
  { connection, concurrency: 5 },
);

const channelOutboundWorker = new Worker<ChannelOutboundJob>(
  QUEUES.channelOutbound,
  async (job) => {
    if (!messengerRuntime) throw new UnrecoverableError('Facebook is not configured');
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? OUTBOUND_JOB.attempts);
    const r = await deliverOutboundMessage(messengerRuntime, job.data.messageId, { finalAttempt });
    log.info({ jobId: job.id, messageId: job.data.messageId, status: r.status }, 'channel-outbound');
    return r;
  },
  { connection, concurrency: 3 },
);

// ---- Quotes (SPEC 6.6) & WooCommerce (5.6) ----
const quotePdfWorker = new Worker<QuotePdfJob>(
  QUEUES.quotePdf,
  async (job) => {
    const r = await generateQuotePdf({ db: prisma, now: () => new Date() }, job.data.quoteId, renderQuotePdf, storage);
    log.info({ jobId: job.id, quoteId: job.data.quoteId, size: r.size }, 'quote-pdf');
    if (job.data.sendToConversationId && job.data.userId) {
      const actor = await prisma.user.findUniqueOrThrow({ where: { id: job.data.userId } });
      const q = await prisma.quote.findUniqueOrThrow({ where: { id: job.data.quoteId }, select: { orgId: true, validUntil: true } });
      // Link valid until 30 days after the quote expires (customers reopen old quotes).
      const ttl = Math.max(86_400, Math.floor((q.validUntil.getTime() - Date.now()) / 1000) + 30 * 86_400);
      await sendQuotePdfToConversation({ ...systemCtx(q.orgId), actor, via: 'WEB' }, job.data.quoteId, job.data.sendToConversationId, ttl);
    }
    return r;
  },
  { connection, concurrency: 2 },
);

const wooQueue = new Queue<WooSyncJob>(QUEUES.wooSync, { connection });
const wooWorker = new Worker<WooSyncJob>(
  QUEUES.wooSync,
  async (job) => {
    const client = await createWooClientFor(prisma, job.data.orgId);
    if (!client) return { skipped: 'not-configured' };
    const r = await syncWooProducts({ db: prisma, effects, now: () => new Date() }, job.data.orgId, client, { full: job.data.full, actorId: job.data.actorId });
    log.info({ jobId: job.id, orgId: job.data.orgId, ...r }, 'woo-product-sync');
    return r;
  },
  { connection, concurrency: 1 },
);

// ---- Chuyển giao (SPEC 6.10): background job with progress ----
const transferWorker = new Worker<TransferJobData>(
  QUEUES.transfer,
  async (job) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: job.data.actorId } });
    const ctx: ServiceContext = { ...systemCtx(job.data.orgId), actor, via: 'WEB' };
    const r = await runTransfer(ctx, job.data.input, (done, total) => job.updateProgress({ done, total }));
    log.info({ jobId: job.id, orgId: job.data.orgId, customers: r.customers, leads: r.leads, tasks: r.tasks }, 'transfer done');
    return r;
  },
  { connection, concurrency: 1 },
);

// getUpdates long polling for machines without a public HTTPS webhook (ZALO_BOT_POLLING=true, live bot).
let polling = process.env.ZALO_BOT_POLLING === 'true' && bot?.mode === 'live';
async function pollLoop() {
  while (polling && bot) {
    try {
      const result = await bot.getUpdates(30);
      for (const item of Array.isArray(result) ? result : result ? [result] : []) {
        const stored = await ingestZaloBotPayload(prisma, item);
        if (stored && !stored.duplicate) await inboundQueue.add('message', { webhookEventId: stored.eventId }, { jobId: `zb-${stored.eventId}`, removeOnComplete: 5000, removeOnFail: 5000 });
      }
    } catch (err) {
      log.error({ err }, 'zalo-bot polling failed');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const workers = [slaWorker, systemWorker, importWorker, botInboundWorker, botNotifyWorker, channelInboundWorker, channelOutboundWorker, quotePdfWorker, wooWorker, transferWorker];
for (const w of workers) {
  w.on('failed', (job, err) => log.error({ queue: w.name, jobId: job?.id, err }, 'job failed'));
}

await systemQueue.upsertJobScheduler('heartbeat', { every: 60_000 }, { name: 'heartbeat' });
await systemQueue.upsertJobScheduler('sla-sweeper', { every: 60_000 }, { name: 'sla-sweeper' });
await systemQueue.upsertJobScheduler('out-of-hours-release', { pattern: '0 8 * * 1-6', tz: 'Asia/Ho_Chi_Minh' }, { name: 'out-of-hours-release' });
await systemQueue.upsertJobScheduler('facebook-token-check', { pattern: '0 7 * * *', tz: 'Asia/Ho_Chi_Minh' }, { name: 'facebook-token-check' });
await systemQueue.upsertJobScheduler('customer-lifecycle', { pattern: '0 1 * * *', tz: 'Asia/Ho_Chi_Minh' }, { name: 'customer-lifecycle' });
await systemQueue.upsertJobScheduler('reorder-reminder', { pattern: '30 7 * * 1-6', tz: 'Asia/Ho_Chi_Minh' }, { name: 'reorder-reminder' });
await systemQueue.upsertJobScheduler('stale-lead', { pattern: '20 * * * *', tz: 'Asia/Ho_Chi_Minh' }, { name: 'stale-lead' });
await systemQueue.upsertJobScheduler('quote-expiry', { pattern: '5 * * * *', tz: 'Asia/Ho_Chi_Minh' }, { name: 'quote-expiry' });
await systemQueue.upsertJobScheduler('woo-sync-tick', { pattern: '15 * * * *', tz: 'Asia/Ho_Chi_Minh' }, { name: 'woo-sync-tick' });
await systemQueue.upsertJobScheduler('task-reminder', { every: 60_000 }, { name: 'task-reminder' });
await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 180);
log.info({ zaloBot: bot?.mode ?? 'disabled', facebook: facebook?.mode ?? 'disabled', polling }, 'worker started');
if (polling) void pollLoop();

// Optional liveness endpoint for orchestration (Docker healthcheck, Playwright webServer).
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
const health = healthPort
  ? createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
    }).listen(healthPort)
  : null;

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  polling = false;
  health?.close();
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([systemQueue.close(), inboundQueue.close(), notifyQueue.close(), wooQueue.close()]);
  await effects.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
