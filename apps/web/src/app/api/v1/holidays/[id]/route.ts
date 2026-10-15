import { deleteHoliday } from '@michio/core';
import { route } from '@/lib/api';

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteHoliday(ctx, params.id);
  return { ok: true };
});
