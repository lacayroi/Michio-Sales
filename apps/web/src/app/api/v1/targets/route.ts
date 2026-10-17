// Chỉ tiêu tháng (SPEC 6.11): GET ?month=yyyy-MM with actuals; PUT upserts (Owner/Manager).
import { listTargets, saveTargets, TargetsInput } from '@michio/core';
import { readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listTargets(ctx, searchParamsOf(req).month));
export const PUT = route(async ({ req, ctx }) => saveTargets(ctx, await readJson(req, TargetsInput)));
