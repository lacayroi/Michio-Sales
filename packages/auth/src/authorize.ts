import type { Prisma } from '@michio/db';
import { type Action, type Role, scopeOf } from './permissions';

export interface AuthUser {
  id: string;
  orgId: string;
  role: Role;
  status: 'AVAILABLE' | 'BUSY' | 'OFF' | 'INACTIVE';
  deletedAt?: Date | null;
}

/** Minimal shape of a record for ownership checks. */
export interface OwnedResource {
  orgId?: string;
  ownerId?: string | null;
  assigneeId?: string | null;
}

export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(
    readonly action: Action,
    message = 'Bạn không có quyền thực hiện thao tác này',
  ) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

function isActive(user: AuthUser): boolean {
  return user.status !== 'INACTIVE' && !user.deletedAt;
}

/**
 * Single permission check for the service layer (SPEC §3).
 * Without `resource` it answers "may this user do this at all"; list queries must then
 * go through `scopeFilter` to restrict OWN-scoped results.
 */
export function authorize(user: AuthUser, action: Action, resource?: OwnedResource): boolean {
  if (!isActive(user)) return false;
  const scope = scopeOf(user.role, action);
  if (!scope) return false;
  if (!resource) return true;
  if (resource.orgId !== undefined && resource.orgId !== user.orgId) return false;
  if (scope === 'ALL') return true;
  const responsible = resource.assigneeId !== undefined ? resource.assigneeId : resource.ownerId;
  return responsible === user.id;
}

export function assertAuthorized(user: AuthUser, action: Action, resource?: OwnedResource): void {
  if (!authorize(user, action, resource)) throw new ForbiddenError(action);
}

type ScopedEntity = {
  lead: Prisma.LeadWhereInput;
  customer: Prisma.CustomerWhereInput;
  deal: Prisma.DealWhereInput;
  quote: Prisma.QuoteWhereInput;
  order: Prisma.OrderWhereInput;
  task: Prisma.TaskWhereInput;
  conversation: Prisma.ConversationWhereInput;
};

const VIEW_ACTION: Record<keyof ScopedEntity, Action> = {
  lead: 'lead.view',
  customer: 'customer.view',
  deal: 'deal.view',
  quote: 'quote.view',
  order: 'order.view',
  task: 'task.view',
  conversation: 'conversation.view',
};

/** Prisma `where` fragment restricting a list query to what the user may see. */
export function scopeFilter<E extends keyof ScopedEntity>(user: AuthUser, entity: E): ScopedEntity[E] {
  const action = VIEW_ACTION[entity];
  if (!isActive(user)) throw new ForbiddenError(action);
  const scope = scopeOf(user.role, action);
  if (!scope) throw new ForbiddenError(action);

  const base = { orgId: user.orgId };
  if (scope === 'ALL') return base as ScopedEntity[E];

  switch (entity) {
    case 'task':
      return { ...base, assigneeId: user.id } as ScopedEntity[E];
    case 'conversation':
      return {
        ...base,
        OR: [{ customer: { ownerId: user.id } }, { lead: { ownerId: user.id } }],
      } as ScopedEntity[E];
    default:
      return { ...base, ownerId: user.id } as ScopedEntity[E];
  }
}
