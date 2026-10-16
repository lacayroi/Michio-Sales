import { updateUser } from '@michio/core';
import { route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ ctx, params }) => {
  const u = await updateUser(ctx, params.id, { status: 'INACTIVE' });
  return { id: u.id, status: u.status };
});
