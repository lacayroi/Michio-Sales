// GET /reports/:name (§8): overview · sources · funnel · sales-comparison · revenue · customers · products · lost-reasons · sla
import { getReport, type ReportName } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route<{ name: string }>(async ({ req, ctx, params }) => getReport(ctx, params.name as ReportName, searchParamsOf(req)));
