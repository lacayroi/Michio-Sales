import { assertAuthorized } from '@michio/auth';
import { createApiKey } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

export const GET = route(async ({ ctx, user }) => {
  assertAuthorized(user, 'integration.manage');
  const items = await ctx.db.apiKey.findMany({ where: { orgId: ctx.orgId }, orderBy: { id: 'desc' }, select: { id: true, name: true, source: true, lastUsedAt: true, revokedAt: true } });
  return { items };
});
const Body = z.object({ name: z.string().trim().min(1).max(120), source: z.enum(['WEBSITE_WHOLESALE_FORM', 'WEBSITE_AGENT_FORM']).default('WEBSITE_WHOLESALE_FORM') });
export const POST = route(async ({ req, ctx }) => createApiKey(ctx, await readJson(req, Body)), { status: 201 });
