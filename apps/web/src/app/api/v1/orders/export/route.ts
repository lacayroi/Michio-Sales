// Excel of orders for the accounting / warehouse software (SPEC 6.7), same filters as the list.
import { exportOrders } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => {
  const buffer = await exportOrders(ctx, searchParamsOf(req));
  const stamp = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="don-hang-${stamp}.xlsx"`,
    },
  });
});
