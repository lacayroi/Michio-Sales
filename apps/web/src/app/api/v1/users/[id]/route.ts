import { updateUser, UserUpdateInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => {
  const u = await updateUser(ctx, params.id, await readJson(req, UserUpdateInput));
  return { id: u.id, fullName: u.fullName, role: u.role, status: u.status, maxOpenLeads: u.maxOpenLeads, phone: u.phone };
});
