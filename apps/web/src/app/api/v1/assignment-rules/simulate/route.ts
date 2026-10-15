import { assertAuthorized } from '@michio/auth';
import { simulateAssignment } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

// "Thử luật" (SPEC 6.12): a fake lead, no side effects.
const Body = z.object({
  source: z.string(),
  businessModel: z.string().nullish(),
  orderBand: z.string().nullish(),
  interestCategories: z.array(z.string()).optional(),
  province: z.string().nullish(),
  tags: z.array(z.string()).optional(),
});

export const POST = route(async ({ req, ctx, user }) => {
  assertAuthorized(user, 'assignmentRule.manage');
  return simulateAssignment(ctx, await readJson(req, Body));
});
