// Demo / e2e only (MOCK_INTEGRATIONS=true, SPEC §12): play a customer writing to the Page on Messenger.
// The message takes the real path (signed webhook body → WebhookEvent → processFacebookEvent), processed
// inline so the inbox updates at once. GET returns what the "customer" received from the shop.
import { assertAuthorized } from '@michio/auth';
import { signedRequest, messengerMessagePayload } from '@michio/channels/mocks/facebook';
import { ingestFacebookWebhook, mockFacebookProfileKey, processFacebookEvent, readMockFacebookMessages } from '@michio/core';
import { prisma } from '@michio/db';
import { z } from 'zod';
import { HttpError, readJson, route, searchParamsOf } from '@/lib/api';
import { messengerRuntime } from '@/lib/integrations';
import { getRedis } from '@/lib/redis';
import { mockMode } from '@/lib/zalo-bot';

function guard() {
  if (!mockMode()) throw new HttpError(404, 'NOT_FOUND', 'Không có');
}

export const GET = route(async ({ req, user }) => {
  guard();
  assertAuthorized(user, 'conversation.view');
  const psid = searchParamsOf(req).psid;
  if (!psid) throw new HttpError(422, 'VALIDATION_ERROR', 'Thiếu psid');
  return { messages: await readMockFacebookMessages(getRedis(), psid) };
});

const Body = z.object({
  psid: z.string().trim().min(3).max(60).regex(/^[\w-]+$/),
  name: z.string().trim().max(80).optional(),
  text: z.string().trim().min(1).max(2000),
});

export const POST = route(async ({ req, user }) => {
  guard();
  assertAuthorized(user, 'conversation.view');
  const { psid, name, text } = await readJson(req, Body);
  const page = await prisma.channelAccount.findFirst({ where: { orgId: user.orgId, type: 'FACEBOOK_PAGE', status: 'ACTIVE' } });
  if (!page) throw new HttpError(409, 'NOT_CONNECTED', 'Chưa kết nối Page Facebook (Cài đặt → Facebook)');
  if (name) await getRedis().set(mockFacebookProfileKey(psid), name, 'EX', 86_400);
  // Built and signed exactly like Meta's webhook, then parsed back as the route would.
  const { body } = signedRequest(messengerMessagePayload({ pageId: page.externalId, psid, text }), 'mock');
  const { eventIds } = await ingestFacebookWebhook(prisma, JSON.parse(body));
  const results = [];
  for (const id of eventIds) results.push(await processFacebookEvent(messengerRuntime()!, id));
  const conv = await prisma.conversation.findUnique({ where: { channelAccountId_externalThreadId: { channelAccountId: page.id, externalThreadId: psid } }, select: { id: true, leadId: true } });
  return { conversationId: conv?.id ?? null, leadId: conv?.leadId ?? null, results };
});
