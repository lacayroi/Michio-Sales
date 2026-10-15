import type { Role } from '@michio/auth/permissions';

// SSE event types (SPEC §8).
export type AppEventType =
  | 'lead.assigned'
  | 'lead.updated'
  | 'assignment.expiring'
  | 'message.new'
  | 'task.due'
  | 'order.updated'
  | 'notification.new';

export interface AppEvent {
  type: AppEventType;
  orgId: string;
  /** Who should receive it: specific users and/or every user with these roles. */
  audience: { userIds?: string[]; roles?: Role[] };
  data: Record<string, unknown>;
}

export const MANAGERS: Role[] = ['OWNER', 'MANAGER'];

export function isInAudience(event: AppEvent, user: { id: string; role: Role }): boolean {
  return Boolean(event.audience.userIds?.includes(user.id) || event.audience.roles?.includes(user.role));
}

export const eventChannel = (orgId: string) => `events:${orgId}`;
