// Demo / e2e only (MOCK_INTEGRATIONS=true, SPEC §12): a chat window that talks to the bot as if from
// Zalo. Messages go through the real pipeline (WebhookEvent → command → reply via the mock client).
import { ingestZaloBotPayload, processZaloBotEvent, pushMockBotMessage, readMockBotMessages } from '@michio/core';
import { prisma } from '@michio/db';
import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { getRedis } from '@/lib/redis';
import { effects } from '@/lib/services';
import { mockChatId, mockMode, zaloBot } from '@/lib/zalo-bot';

function guard() {
  if (!mockMode()) throw new HttpError(404, 'NOT_FOUND', 'Không có');
}

export const GET = route(async ({ user }) => {
  guard();
  return { chatId: mockChatId(user.id), messages: await readMockBotMessages(getRedis(), mockChatId(user.id)) };
});

const Body = z.object({ text: z.string().trim().min(1).max(2000) });

export const POST = route(async ({ req, user }) => {
  guard();
  const { text } = await readJson(req, Body);
  const chatId = mockChatId(user.id);
  const bot = zaloBot()!;
  await pushMockBotMessage(getRedis(), { chatId, text, at: new Date().toISOString(), from: 'user' });
  const stored = await ingestZaloBotPayload(prisma, {
    ok: true,
    result: { event_name: 'message.text.received', message: { message_id: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`, chat: { id: chatId, chat_type: 'PRIVATE' }, from: { id: chatId, display_name: user.fullName }, text, date: Date.now() } },
  });
  // Processed inline so the simulator shows the reply at once.
  if (stored) await processZaloBotEvent({ db: prisma, effects: effects(), now: () => new Date() }, stored.eventId, (c, t) => bot.sendMessage(c, t));
  return { chatId, messages: await readMockBotMessages(getRedis(), chatId) };
});
