// Side effects that must only happen after the database transaction commits:
// SSE events (Redis pub/sub) and delayed SLA jobs (BullMQ). The runtime (web/worker) supplies
// the implementation; tests use `recordingEffects()`.
import type { Role } from '@michio/auth';

export type DomainEventType =
  | 'lead.assigned'
  | 'lead.updated'
  | 'assignment.expiring'
  | 'message.new'
  | 'task.due'
  | 'order.updated'
  | 'notification.new';

export interface DomainEvent {
  type: DomainEventType;
  orgId: string;
  /** Recipients: these users plus everyone with one of `roles`. */
  userIds?: string[];
  roles?: Role[];
  data: Record<string, unknown>;
}

export interface Effects {
  publish(event: DomainEvent): Promise<void>;
  /** Check (and warn shortly before) an assignment's accept deadline. */
  scheduleSlaCheck(assignmentId: string, deadline: Date): Promise<void>;
}

export const noopEffects: Effects = {
  async publish() {},
  async scheduleSlaCheck() {},
};

/** Collects effects during a transaction; `flush` runs them once the transaction has committed. */
export class EffectBuffer {
  private queue: ((fx: Effects) => Promise<void>)[] = [];

  publish(event: DomainEvent) {
    this.queue.push((fx) => fx.publish(event));
  }

  scheduleSlaCheck(assignmentId: string, deadline: Date) {
    this.queue.push((fx) => fx.scheduleSlaCheck(assignmentId, deadline));
  }

  async flush(fx: Effects) {
    const items = this.queue;
    this.queue = [];
    // Effects are best-effort: the sla-sweeper and page reloads recover from a lost one.
    await Promise.allSettled(items.map((run) => run(fx)));
  }
}

export interface RecordingEffects extends Effects {
  events: DomainEvent[];
  slaChecks: { assignmentId: string; deadline: Date }[];
}

export function recordingEffects(): RecordingEffects {
  const events: DomainEvent[] = [];
  const slaChecks: { assignmentId: string; deadline: Date }[] = [];
  return {
    events,
    slaChecks,
    async publish(e) {
      events.push(e);
    },
    async scheduleSlaCheck(assignmentId, deadline) {
      slaChecks.push({ assignmentId, deadline });
    },
  };
}
