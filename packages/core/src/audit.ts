import type { Prisma, PrismaClient } from '@michio/db';

export type AuditVia = 'WEB' | 'ZALO_BOT' | 'API' | 'SYSTEM';

export interface AuditEntry {
  orgId: string;
  actorId?: string | null;
  via: AuditVia;
  action: string; // e.g. "auth.login", "lead.assign"
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
}

type Db = Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient;

/** Append-only audit trail (SPEC 6.12). Pass the transaction client to keep it atomic with the change. */
export function recordAudit(db: Db, entry: AuditEntry) {
  return db.auditLog.create({ data: entry });
}
