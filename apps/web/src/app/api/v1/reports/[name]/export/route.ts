// GET /reports/:name/export — Excel of the report with the current filters (SPEC 6.11).
import { exportReport, type ReportName } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route<{ name: string }>(async ({ req, ctx, params }) => {
  const { fileName, buffer } = await exportReport(ctx, params.name as ReportName, searchParamsOf(req));
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}"` },
  });
});
