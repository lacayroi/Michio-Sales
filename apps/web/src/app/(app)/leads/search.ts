import type { LeadFilters, leadListInclude } from '@michio/core';
import type { Lead, Prisma } from '@michio/db';
import type { LeadRow } from './lead-table';

const list = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : undefined);

/** URL search params (+ the tab's preset query) → LeadFilters. */
export function parseLeadSearch(sp: Record<string, string | undefined>, tabQuery: string): LeadFilters {
  const preset = Object.fromEntries(new URLSearchParams(tabQuery));
  const get = (k: string) => sp[k] || preset[k];
  return {
    status: list(get('status')) as LeadFilters['status'],
    source: list(get('source')) as LeadFilters['source'],
    priority: list(get('priority')) as LeadFilters['priority'],
    ownerId: get('ownerId'),
    q: get('q'),
    slaBreached: get('slaBreached') === '1' || undefined,
  };
}

type LeadWithList = Lead & Prisma.LeadGetPayload<{ include: typeof leadListInclude }>;

export function toLeadRow(l: LeadWithList): LeadRow {
  return {
    id: l.id,
    code: l.code,
    status: l.status,
    priority: l.priority,
    source: l.source,
    isRepurchase: l.isRepurchase,
    createdAt: l.createdAt.toISOString(),
    need: l.need,
    contactName: l.customer.contactName,
    shopName: l.customer.shopName,
    phone: l.customer.phone,
    province: l.customer.province,
    ownerName: l.owner?.fullName ?? null,
    acceptDeadline: l.assignments[0]?.acceptDeadline?.toISOString() ?? null,
    firstContactOverdue: l.status === 'IN_PROGRESS' && !l.firstContactAt && !!l.firstContactDeadline && l.firstContactDeadline < new Date(),
  };
}
