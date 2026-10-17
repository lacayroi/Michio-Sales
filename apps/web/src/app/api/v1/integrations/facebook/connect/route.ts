// Owner connects the Page (SPEC 5.2 "Thiết lập"). GET: start Facebook login (or, with mocks, connect
// the demo Page at once). POST {state, pageId}: connect the Page picked after the callback.
import { randomBytes } from 'node:crypto';
import { assertAuthorized } from '@michio/auth';
import { facebookLoginUrl } from '@michio/channels';
import { connectFacebookPage, isMockIntegrations } from '@michio/core';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { clearOauthState, facebookCallbackUrl, loadPendingPages, oauthStateOwner, saveOauthState } from '@/lib/facebook-oauth';
import { facebookClient } from '@/lib/integrations';

export const GET = route(async ({ req, user, ctx }) => {
  assertAuthorized(user, 'integration.manage');
  const client = facebookClient();
  if (!client) throw new HttpError(503, 'NOT_CONFIGURED', 'Chưa cấu hình FB_APP_ID / FB_APP_SECRET');
  if (isMockIntegrations()) {
    const [page] = await client.listPages('mock');
    await connectFacebookPage(ctx, { pageId: page!.id, name: page!.name, pageToken: page!.accessToken, mock: true });
    return NextResponse.redirect(new URL('/cai-dat/facebook?connected=1', req.url));
  }
  const state = randomBytes(16).toString('hex');
  await saveOauthState(state, user.id);
  return NextResponse.redirect(facebookLoginUrl({ appId: process.env.FB_APP_ID! }, facebookCallbackUrl(), state));
});

const Body = z.object({ state: z.string().min(10), pageId: z.string().min(1) });

export const POST = route(async ({ req, user, ctx }) => {
  assertAuthorized(user, 'integration.manage');
  const { state, pageId } = await readJson(req, Body);
  if ((await oauthStateOwner(state)) !== user.id) throw new HttpError(409, 'STATE_EXPIRED', 'Phiên kết nối đã hết hạn, hãy bấm "Kết nối Facebook" lại');
  const pending = await loadPendingPages(state);
  const page = pending?.pages.find((p) => p.id === pageId);
  if (!pending || !page) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy Page');
  await facebookClient()!.subscribePage(page.id, page.accessToken);
  const account = await connectFacebookPage(ctx, {
    pageId: page.id,
    name: page.name,
    pageToken: page.accessToken,
    userTokenExpiresAt: pending.userTokenExpiresAt ? new Date(pending.userTokenExpiresAt) : null,
  });
  await clearOauthState(state);
  return { id: account.id, name: account.name };
});
