import type { AuthUser, Role } from '@michio/auth';
import type { Prisma, PrismaClient } from '@michio/db';
import type { AuditVia } from './audit';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

/** Who is acting. `user` is null for the system (jobs) and for API-key callers (website form). */
export interface Actor {
  orgId: string;
  user: AuthUser | null;
  via: AuditVia;
  ip?: string | null;
}

export const systemActor = (orgId: string): Actor => ({ orgId, user: null, via: 'SYSTEM' });
export const apiActor = (orgId: string, ip?: string | null): Actor => ({ orgId, user: null, via: 'API', ip });
export const userActor = (user: AuthUser, via: AuditVia = 'WEB', ip?: string | null): Actor => ({
  orgId: user.orgId,
  user,
  via,
  ip,
});

export const MANAGER_ROLES: Role[] = ['OWNER', 'MANAGER'];

/** Interactive transactions wait on advisory locks under load (90 concurrent leads, SPEC 6.3 AC). */
export const TX_OPTIONS = { maxWait: 30_000, timeout: 30_000 } as const;
