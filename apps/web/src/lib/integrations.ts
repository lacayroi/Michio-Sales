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
