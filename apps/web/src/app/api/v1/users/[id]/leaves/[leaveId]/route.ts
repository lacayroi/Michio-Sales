import { deleteLeave } from '@michio/core';
import { route } from '@/lib/api';

export const DELETE = route<{ id: string; leaveId: string }>(async ({ ctx, params }) => {
  await deleteLeave(ctx, params.id, params.leaveId);
  return { ok: true };
});
