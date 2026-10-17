import 'server-only';
import type { FbPage } from '@michio/channels';
import { decryptJson, encryptJson } from '@michio/core';
import { getRedis } from './redis';

// Short-lived OAuth state (10 minutes) — ties the callback to the Owner who started it.
const TTL = 600;
export const facebookCallbackUrl = () => `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1/integrations/facebook/callback`;

export async function saveOauthState(state: string, userId: string) {
  await getRedis().set(`fb-oauth:${state}`, userId, 'EX', TTL);
}
export async function oauthStateOwner(state: string) {
  return getRedis().get(`fb-oauth:${state}`);
}
/** Page tokens wait (encrypted) for the Owner to pick which Page to connect. */
export async function savePendingPages(state: string, pages: FbPage[], userTokenExpiresAt: Date | null) {
  await getRedis().set(`fb-pages:${state}`, Buffer.from(encryptJson({ pages, userTokenExpiresAt })).toString('base64'), 'EX', TTL);
}
export async function loadPendingPages(state: string): Promise<{ pages: FbPage[]; userTokenExpiresAt: string | null } | null> {
  const raw = await getRedis().get(`fb-pages:${state}`);
  return raw ? decryptJson(Buffer.from(raw, 'base64')) : null;
}
export async function clearOauthState(state: string) {
  await getRedis().del(`fb-oauth:${state}`, `fb-pages:${state}`);
}
