import { describe, expect, it } from 'vitest';
import { assertAuthorized, type AuthUser, authorize, ForbiddenError, scopeFilter } from './authorize';

const mk = (role: AuthUser['role'], over: Partial<AuthUser> = {}): AuthUser => ({
  id: `u-${role.toLowerCase()}`,
  orgId: 'org-1',
  role,
  status: 'AVAILABLE',
  deletedAt: null,
  ...over,
});
const owner = mk('OWNER');
const manager = mk('MANAGER');
const sales = mk('SALES');
const support = mk('SUPPORT');
const viewer = mk('VIEWER');

describe('authorize', () => {
  const ownLead = { orgId: 'org-1', ownerId: sales.id };
  const otherLead = { orgId: 'org-1', ownerId: 'u-other' };

  it('ALL scope allows any record of the same org', () => {
    expect(authorize(owner, 'lead.update', otherLead)).toBe(true);
    expect(authorize(manager, 'lead.update', otherLead)).toBe(true);
    expect(authorize(support, 'lead.view', otherLead)).toBe(true);
  });

  it('OWN scope only allows the responsible user', () => {
    expect(authorize(sales, 'lead.update', ownLead)).toBe(true);
    expect(authorize(sales, 'lead.update', otherLead)).toBe(false);
    expect(authorize(sales, 'lead.view', { ownerId: null })).toBe(false);
  });

  it('OWN scope on tasks uses assigneeId', () => {
    expect(authorize(support, 'task.manage', { assigneeId: support.id, ownerId: 'x' })).toBe(true);
    expect(authorize(support, 'task.manage', { assigneeId: 'u-other' })).toBe(false);
  });

  it('read-only roles cannot write', () => {
    expect(authorize(support, 'lead.update', otherLead)).toBe(false);
    expect(authorize(viewer, 'customer.update', otherLead)).toBe(false);
    expect(authorize(sales, 'order.updateFulfillment', { ownerId: sales.id })).toBe(false);
  });

  it('rejects cross-org records even with ALL scope', () => {
    expect(authorize(owner, 'lead.view', { orgId: 'org-2', ownerId: owner.id })).toBe(false);
  });

  it('capability check without resource', () => {
    expect(authorize(sales, 'lead.create')).toBe(true);
    expect(authorize(sales, 'lead.assign')).toBe(false);
  });

  it('inactive or deleted users are denied everything', () => {
    expect(authorize(mk('OWNER', { status: 'INACTIVE' }), 'lead.view')).toBe(false);
    expect(authorize(mk('OWNER', { deletedAt: new Date() }), 'lead.view')).toBe(false);
  });

  it('assertAuthorized throws ForbiddenError', () => {
    expect(() => assertAuthorized(viewer, 'user.manage')).toThrow(ForbiddenError);
    expect(() => assertAuthorized(owner, 'user.manage')).not.toThrow();
  });
});

describe('scopeFilter', () => {
  it('ALL → org only', () => {
    expect(scopeFilter(owner, 'lead')).toEqual({ orgId: 'org-1' });
    expect(scopeFilter(support, 'order')).toEqual({ orgId: 'org-1' });
  });

  it('OWN → owner field per entity', () => {
    expect(scopeFilter(sales, 'lead')).toEqual({ orgId: 'org-1', ownerId: sales.id });
    expect(scopeFilter(sales, 'customer')).toEqual({ orgId: 'org-1', ownerId: sales.id });
    expect(scopeFilter(sales, 'quote')).toEqual({ orgId: 'org-1', ownerId: sales.id });
    expect(scopeFilter(support, 'task')).toEqual({ orgId: 'org-1', assigneeId: support.id });
    expect(scopeFilter(sales, 'conversation')).toEqual({
      orgId: 'org-1',
      OR: [{ customer: { ownerId: sales.id } }, { lead: { ownerId: sales.id } }],
    });
  });

  it('throws when the role cannot view the entity', () => {
    expect(() => scopeFilter(viewer, 'conversation')).toThrow(ForbiddenError);
    expect(() => scopeFilter(viewer, 'order')).toThrow(ForbiddenError);
    expect(() => scopeFilter(mk('SALES', { status: 'INACTIVE' }), 'lead')).toThrow(ForbiddenError);
  });
});
