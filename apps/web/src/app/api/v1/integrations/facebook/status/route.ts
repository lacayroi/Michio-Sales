import { facebookStatus } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';
import { loadPendingPages, oauthStateOwner } from '@/lib/facebook-oauth';

export const GET = route(async ({ req, ctx, user }) => {
  const status = await facebookStatus(ctx);
  const pick = searchParamsOf(req).pick;
  const pending = pick && (await oauthStateOwner(pick)) === user.id ? await loadPendingPages(pick) : null;
  // Never send page tokens to the browser.
  return { ...status, pendingPages: pending?.pages.map((p) => ({ id: p.id, name: p.name })) ?? [] };
});
