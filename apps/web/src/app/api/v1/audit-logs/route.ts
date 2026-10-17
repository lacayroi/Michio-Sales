import { listAuditLogs } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listAuditLogs(ctx, searchParamsOf(req)));
