import { assertAuthorized } from '@michio/auth';
import { createRule, RuleInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route(async ({ ctx, user }) => {
  assertAuthorized(user, 'assignmentRule.manage');
  return { items: await ctx.db.assignmentRule.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] }) };
});
export const POST = route(async ({ req, ctx }) => createRule(ctx, await readJson(req, RuleInput)), { status: 201 });
