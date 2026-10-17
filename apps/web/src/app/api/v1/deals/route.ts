import { getPipeline } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => getPipeline(ctx, searchParamsOf(req)));
