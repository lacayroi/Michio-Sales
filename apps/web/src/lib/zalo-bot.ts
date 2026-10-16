import 'server-only';
import { createZaloBotClient, isMockIntegrations } from '@michio/core';
import type { ZaloBotClient } from '@michio/channels';
import { getRedis } from './redis';

const g = globalThis as unknown as { zaloBot?: ZaloBotClient | null };

/** Same client choice as the worker (live API or the mock writing to Redis). */
export function zaloBot(): ZaloBotClient | null {
  if (g.zaloBot === undefined) g.zaloBot = createZaloBotClient(getRedis());
  return g.zaloBot;
}

export const mockMode = isMockIntegrations;
export const mockChatId = (userId: string) => `mock-${userId}`;
export const zaloWebhookUrl = () => (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/zalo-bot` : null);
