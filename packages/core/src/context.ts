import type { AuthUser } from '@michio/auth';
import type { PrismaClient } from '@michio/db';
import type { AuditVia } from './audit';
import type { AppEvent } from './events';

/** Side effects that happen after a transaction commits (queues, realtime). Implemented per app. */
export interface Effects {
  scheduleSlaCheck(assignmentId: string, at: Date): Promise<void>;
  publish(event: AppEvent): Promise<void>;
}

export interface ServiceContext {
  db: PrismaClient;
  effects: Effects;
  now: () => Date;
  /** null for system jobs / public API. */
  actor: AuthUser | null;
  orgId: string;
  via: AuditVia;
  ip?: string | null;
}

/** Collects effects during a transaction; flushed only after commit so nothing leaks on rollback. */
export class Outbox {
  private items: (() => Promise<void>)[] = [];
  constructor(private effects: Effects) {}
  publish(event: AppEvent) {
    this.items.push(() => this.effects.publish(event));
  }
  scheduleSlaCheck(assignmentId: string, at: Date) {
    this.items.push(() => this.effects.scheduleSlaCheck(assignmentId, at));
  }
  async flush() {
    const items = this.items;
    this.items = [];
    for (const run of items) await run();
  }
}

export const TX_OPTIONS = { maxWait: 30_000, timeout: 30_000 } as const;

/** In-memory effects for tests and scripts. */
export class RecordingEffects implements Effects {
  readonly events: AppEvent[] = [];
  readonly slaChecks: { assignmentId: string; at: Date }[] = [];
  async scheduleSlaCheck(assignmentId: string, at: Date) {
    this.slaChecks.push({ assignmentId, at });
  }
  async publish(event: AppEvent) {
    this.events.push(event);
  }
}
