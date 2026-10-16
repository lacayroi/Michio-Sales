import { can } from '@michio/auth';
import { assignableUsers, listLeads } from '@michio/core';
import { prisma } from '@michio/db';
import { LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { navItem } from '@/lib/nav';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';
import { LeadFilters } from './lead-filters';
import { LeadTable, type LeadRow } from './lead-table';
import { parseLeadSearch, toLeadRow } from './search';

const HREF = '/leads';
export const metadata = { title: navItem(HREF).label };

const TABS = [
  { key: 'open', label: 'Đang mở', query: 'status=NEW,UNASSIGNED,ASSIGNED,IN_PROGRESS' },
  { key: 'pending', label: 'Chờ nhận', query: 'status=ASSIGNED' },
  { key: 'progress', label: 'Đang xử lý', query: 'status=IN_PROGRESS' },
  { key: 'queue', label: 'Chờ giao', query: 'status=NEW,UNASSIGNED', managersOnly: true },
  { key: 'overdue', label: 'Quá hạn', query: 'slaBreached=1' },
  { key: 'all', label: 'Tất cả', query: '' },
];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('lead.view');
  const sp = await searchParams;
  const tab = sp.tab ?? 'open';
  const filters = parseLeadSearch(sp, TABS.find((t) => t.key === tab)?.query ?? '');
  const isManager = can(user.role, 'lead.assign');
  const [page, users] = await Promise.all([listLeads(prisma, user, filters, { limit: 30 }), isManager ? assignableUsers(prisma, user.orgId) : Promise.resolve([])]);
  const rows: LeadRow[] = page.items.map(toLeadRow);

  // the API query for "Tải thêm" mirrors the server filters
  const apiQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    apiQuery.set(k, Array.isArray(v) ? v.join(',') : v instanceof Date ? v.toISOString() : String(v));
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold">Lead</h1>
      </div>
      <nav aria-label="Lọc nhanh" className="-mx-4 mb-3 flex gap-1 overflow-x-auto px-4 pb-1">
        {TABS.filter((t) => !t.managersOnly || isManager).map((t) => (
          <Link
            key={t.key}
            href={`${HREF}?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium',
              tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-muted',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <LeadFilters
        initial={{ q: sp.q ?? '', source: sp.source ?? '', priority: sp.priority ?? '', ownerId: sp.ownerId ?? '' }}
        tab={tab}
        sources={Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
        owners={isManager ? users.map((u) => ({ value: u.id, label: u.fullName })) : null}
      />
      <LeadTable
        initialRows={rows}
        initialCursor={page.nextCursor}
        apiQuery={apiQuery.toString()}
        assignees={can(user.role, 'lead.bulkAssign') ? users.map((u) => ({ id: u.id, fullName: u.fullName })) : null}
        showOwner={user.role !== 'SALES'}
      />
    </section>
  );
}
