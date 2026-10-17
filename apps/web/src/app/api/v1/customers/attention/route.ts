// GET /customers/attention (§8, S8): sắp / quá hạn tái đặt, AT_RISK, DORMANT.
import { listAttention } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listAttention(ctx, searchParamsOf(req)));
