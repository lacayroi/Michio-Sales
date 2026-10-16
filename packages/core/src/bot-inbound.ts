// Inbound Zalo Bot messages (SPEC 5.5, 11.4): store as WebhookEvent (idempotent + replayable),
// then process in the `zalo-bot-inbound` queue. Replies are sent by the caller through packages/channels.
import { createHash } from 'node:crypto';
import { parseZaloBotUpdate } from '@michio/channels';
import { Prisma } from '@michio/db';
import { type BotRuntime, handleBotUpdate } from './bot';

export const ZALO_BOT_SOURCE = 'zalo-bot';

/** Store a webhook/getUpdates payload once. Returns null when the payload has no chat to answer. */
export async function ingestZaloBotPayload(db: BotRuntime['db'], payload: unknown): Promise<{ eventId: string; duplicate: boolean } | null> {
  const update = parseZaloBotUpdate(payload);
  if (!update) return null;
  const key = `${ZALO_BOT_SOURCE}:${update.messageId ?? createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
  try {
    const ev = await db.webhookEvent.create({ data: { source: ZALO_BOT_SOURCE, eventKey: key, payload: payload as Prisma.InputJsonValue, status: 'RECEIVED' } });
    return { eventId: ev.id, duplicate: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const ev = await db.webhookEvent.findUniqueOrThrow({ where: { eventKey: key } });
      return { eventId: ev.id, duplicate: true };
    }
    throw err;
  }
}

/** Run the command in a stored event and send the replies. Re-running a processed event is a no-op. */
export async function processZaloBotEvent(rt: BotRuntime, eventId: string, send: (chatId: string, text: string) => Promise<unknown>) {
  const ev = await rt.db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.status === 'PROCESSED') return { skipped: true as const };
  const update = parseZaloBotUpdate(ev.payload);
  if (!update) {
    await rt.db.webhookEvent.update({ where: { id: eventId }, data: { status: 'FAILED', error: 'unparseable payload', processedAt: rt.now() } });
    return { skipped: true as const };
  }
  try {
    const replies = await handleBotUpdate(rt, update);
    for (const text of replies) await send(update.chatId, text);
    await rt.db.webhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', error: null, processedAt: rt.now() } });
    return { skipped: false as const, replies };
  } catch (err) {
    await rt.db.webhookEvent.update({ where: { id: eventId }, data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 500) : String(err), processedAt: rt.now() } });
    throw err;
  }
}
