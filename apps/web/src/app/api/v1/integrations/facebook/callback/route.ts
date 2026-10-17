// Facebook login redirect: code → long-lived user token → Pages; the Owner then picks the Page.
import { assertAuthorized } from '@michio/auth';
import { NextResponse } from 'next/server';
import { HttpError, route } from '@/lib/api';
import { facebookCallbackUrl, oauthStateOwner, savePendingPages } from '@/lib/facebook-oauth';
import { facebookClient } from '@/lib/integrations';

export const GET = route(async ({ req, user }) => {
  assertAuthorized(user, 'integration.manage');
  const q = new URL(req.url).searchParams;
  const state = q.get('state') ?? '';
  const error = q.get('error_description') ?? q.get('error');
  if (error) return NextResponse.redirect(new URL(`/cai-dat/facebook?error=${encodeURIComponent(error)}`, req.url));
  if (!state || (await oauthStateOwner(state)) !== user.id) throw new HttpError(409, 'STATE_EXPIRED', 'Phiên kết nối đã hết hạn');
  const client = facebookClient();
  if (!client) throw new HttpError(503, 'NOT_CONFIGURED', 'Chưa cấu hình FB_APP_ID / FB_APP_SECRET');
  const { userToken, expiresAt } = await client.exchangeCode(q.get('code') ?? '', facebookCallbackUrl());
  await savePendingPages(state, await client.listPages(userToken), expiresAt);
  return NextResponse.redirect(new URL(`/cai-dat/facebook?pick=${state}`, req.url));
});
