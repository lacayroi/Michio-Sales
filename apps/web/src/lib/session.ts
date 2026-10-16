import 'server-only';
import { type Action, type AuthUser, can, SESSION_COOKIE, verifySessionToken } from '@michio/auth';
import { prisma } from '@michio/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { env } from './env';

export interface CurrentUser extends AuthUser {
  email: string;
  fullName: string;
  phone: string | null;
  mustChangePassword: boolean;
}

/** Loads the signed-in user from DB on every request so deactivation/role changes apply immediately. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await verifySessionToken(token, env.sessionSecret);
  if (!claims) return null;
  const user = await prisma.user.findFirst({
    where: { id: claims.userId, orgId: claims.orgId, deletedAt: null, status: { not: 'INACTIVE' } },
    select: { id: true, orgId: true, role: true, status: true, email: true, fullName: true, phone: true, deletedAt: true, mustChangePassword: true },
  });
  return user;
});

/** For server components: redirect to login, or to the "no permission" page. */
export async function requireUser(action?: Action, ...alternatives: Action[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/api/v1/auth/logout'); // clears a stale cookie, then goes to /login
  if (action && ![action, ...alternatives].some((a) => can(user.role, a))) redirect('/khong-co-quyen');
  return user;
}
