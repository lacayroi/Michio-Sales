import 'server-only';
import { createFacebookClient, createS3Storage, type MessengerRuntime, type ObjectStorage } from '@michio/core';
import type { FacebookClient } from '@michio/channels';
import { prisma } from '@michio/db';
import { getRedis } from './redis';
import { effects } from './services';

const g = globalThis as unknown as { facebook?: FacebookClient | null; storage?: ObjectStorage };

/** Same client choice as the worker: mock (MOCK_INTEGRATIONS=true), Graph API, or null when not configured. */
export function facebookClient(): FacebookClient | null {
  if (g.facebook === undefined) g.facebook = createFacebookClient(getRedis());
  return g.facebook;
}

export function messengerRuntime(): MessengerRuntime | null {
  const client = facebookClient();
  return client ? { db: prisma, effects: effects(), now: () => new Date(), client, appId: process.env.FB_APP_ID ?? null } : null;
}

export function storage(): ObjectStorage {
  g.storage ??= createS3Storage();
  return g.storage;
}

export const appBaseUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const pdfEvents = globalThis as unknown as { quotePdfEvents?: import('bullmq').QueueEvents };

/**
 * The quote PDF (rendered by the worker's `quote-pdf` job, SPEC §9). Edits clear `pdfKey`, so a
 * missing key means "render now": enqueue and wait (rendering takes ~1 s).
 */
export async function quotePdf(quoteId: string): Promise<{ body: Buffer; code: string }> {
  const { prisma } = await import('@michio/db');
  const { QueueEvents } = await import('bullmq');
  const { QUEUES } = await import('@michio/core');
  const { queue } = await import('./services');
  let q = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { code: true, pdfKey: true, updatedAt: true } });
  if (!q.pdfKey) {
    // Blocking reads: BullMQ requires maxRetriesPerRequest = null on this connection.
    pdfEvents.quotePdfEvents ??= new QueueEvents(QUEUES.quotePdf, { connection: getRedis().duplicate({ maxRetriesPerRequest: null }) });
    const job = await queue(QUEUES.quotePdf).add('render', { quoteId }, { jobId: `pdf-${quoteId}-${q.updatedAt.getTime()}`, removeOnComplete: 1000, removeOnFail: 1000, attempts: 2 });
    await job.waitUntilFinished(pdfEvents.quotePdfEvents, 30_000);
    q = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { code: true, pdfKey: true, updatedAt: true } });
  }
  const file = q.pdfKey ? await storage().get(q.pdfKey) : null;
  if (!file) throw new Error('PDF chưa sẵn sàng, thử lại sau ít phút');
  return { body: file.body, code: q.code };
}
