import { deleteRule, RuleInput, updateRule } from '@michio/core';
import { readJson, route } from '@/lib/api';

type P = { id: string };
export const PATCH = route<P>(async ({ req, ctx, params }) => updateRule(ctx, params.id, await readJson(req, RuleInput.partial())));
export const DELETE = route<P>(async ({ ctx, params }) => {
  await deleteRule(ctx, params.id);
  return { ok: true };
});
