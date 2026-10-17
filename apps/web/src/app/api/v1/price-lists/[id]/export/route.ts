import { exportPriceList } from '@michio/core';
import { route } from '@/lib/api';

export const GET = route<{ id: string }>(async ({ ctx, params }) => {
  const { fileName, buffer } = await exportPriceList(ctx, params.id);
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}"` },
  });
});
