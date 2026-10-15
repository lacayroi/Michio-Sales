import { createUser, listUsers, UserCreateInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route(async ({ ctx }) => ({ items: await listUsers(ctx) }));
export const POST = route(async ({ req, ctx }) => {
  const { user, tempPassword } = await createUser(ctx, await readJson(req, UserCreateInput));
  return { user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }, tempPassword };
}, { status: 201 });
