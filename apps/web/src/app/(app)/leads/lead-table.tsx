'use client';

import { formatDateTime, LEAD_SOURCE_LABELS, toLocalVnPhone } from '@michio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Countdown } from '@/components/countdown';
import { LeadStatusBadge, PriorityBadge } from '@/components/lead-badges';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/client';

export interface LeadRow {
  id: string;
  code: number;
  status: 'NEW' | 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'WON' | 'LOST';
  priority: 'HOT' | 'WARM' | 'COLD';
  source: keyof typeof LEAD_SOURCE_LABELS;
  isRepurchase: boolean;
  createdAt: string;
  need: string | null;
  contactName: string;
  shopName: string | null;
  phone: string | null;
  province: string | null;
  ownerName: string | null;
  acceptDeadline: string | null;
  firstContactOverdue: boolean;
}

interface ApiLead {
  id: string;
  code: number;
  status: LeadRow['status'];
  priority: LeadRow['priority'];
  source: LeadRow['source'];
  isRepurchase: boolean;
  createdAt: string;
  need: string | null;
  firstContactAt: string | null;
  firstContactDeadline: string | null;
  customer: { contactName: string; shopName: string | null; phone: string | null; province: string | null };
  owner: { fullName: string } | null;
  assignments: { acceptDeadline: string | null }[];
}

const fromApi = (l: ApiLead): LeadRow => ({
  id: l.id,
  code: l.code,
  status: l.status,
  priority: l.priority,
  source: l.source,
  isRepurchase: l.isRepurchase,
  createdAt: l.createdAt,
  need: l.need,
  contactName: l.customer.contactName,
  shopName: l.customer.shopName,
  phone: l.customer.phone,
  province: l.customer.province,
  ownerName: l.owner?.fullName ?? null,
  acceptDeadline: l.assignments[0]?.acceptDeadline ?? null,
  firstContactOverdue: l.status === 'IN_PROGRESS' && !l.firstContactAt && !!l.firstContactDeadline && new Date(l.firstContactDeadline) < new Date(),
});

function SlaCell({ row }: { row: LeadRow }) {
  if (row.status === 'ASSIGNED' && row.acceptDeadline) return <Countdown deadline={row.acceptDeadline} className="text-xs" />;
  if (row.firstContactOverdue) return <span className="text-xs font-semibold text-accent-text">Quá hạn liên hệ</span>;
  return null;
}

export function LeadTable({
  initialRows,
  initialCursor,
  apiQuery,
  assignees,
  showOwner,
}: {
  initialRows: LeadRow[];
  initialCursor: string | null;
  apiQuery: string;
  assignees: { id: string; fullName: string }[] | null;
  showOwner: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A server refresh (filters changed, SSE update) replaces the first page.
  useEffect(() => {
    setRows(initialRows);
    setCursor(initialCursor);
  }, [initialRows, initialCursor]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const res = await api<{ items: ApiLead[]; nextCursor: string | null }>(`/api/v1/leads?${apiQuery}&limit=30&cursor=${cursor}`);
    setLoading(false);
    if (res.ok && res.data) {
      setRows((r) => [...r, ...res.data!.items.map(fromApi)]);
      setCursor(res.data.nextCursor);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function bulkAssign() {
    if (!target || !selected.size) return;
    setError(null);
    setMessage(null);
    const res = await api<{ ok: number; failed: number }>('/api/v1/leads/bulk-assign', {
      body: target === 'auto' ? { leadIds: [...selected], auto: true } : { leadIds: [...selected], userId: target },
    });
    if (!res.ok) return setError(res.error?.message ?? null);
    setMessage(`Đã giao ${res.data!.ok} lead${res.data!.failed ? `, ${res.data!.failed} lead lỗi` : ''}.`);
    setSelected(new Set());
    router.refresh();
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center">
        <p className="font-medium">Không có lead nào</p>
        <p className="text-sm text-muted-foreground">Thử bỏ bớt bộ lọc, hoặc tạo lead bằng nút “Lead nhanh”.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {assignees && selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-surface p-3 shadow-sm">
          <span className="text-sm font-semibold">Đã chọn {selected.size} lead</span>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Giao cho" className="w-auto min-w-48">
            <option value="">Giao cho…</option>
            <option value="auto">Chia tự động theo luật</option>
            {assignees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={bulkAssign} disabled={!target}>
            Giao
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}
      <FormError message={error} />
      {message && (
        <p role="status" className="text-sm font-medium text-primary">
          {message}
        </p>
      )}

      {/* phones: cards */}
      <ul className="flex flex-col gap-2 md:hidden" data-testid="lead-cards">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-start gap-2">
              {assignees && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Chọn lead #${r.code}`} className="mt-1 size-4" />}
              <Link href={`/leads/${r.id}`} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">#{r.code}</span>
                  <PriorityBadge priority={r.priority} />
                  <LeadStatusBadge status={r.status} />
                </div>
                <p className="mt-1 truncate font-semibold">{r.contactName}</p>
                <p className="truncate text-sm text-muted-foreground">{[r.shopName, r.province].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>{LEAD_SOURCE_LABELS[r.source]}</span>
                  {r.phone && <span className="tabular-nums">{toLocalVnPhone(r.phone)}</span>}
                  {showOwner && <span>{r.ownerName ?? 'Chưa giao'}</span>}
                </p>
                <SlaCell row={r} />
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {/* desktop: table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs font-semibold text-muted-foreground uppercase">
            <tr>
              {assignees && (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả"
                    checked={selected.size === rows.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                    className="size-4"
                  />
                </th>
              )}
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Khách</th>
              <th className="px-3 py-2">SĐT</th>
              <th className="px-3 py-2">Nguồn</th>
              <th className="px-3 py-2">Trạng thái</th>
              {showOwner && <th className="px-3 py-2">Phụ trách</th>}
              <th className="px-3 py-2">Tạo lúc</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40" data-testid="lead-row">
                {assignees && (
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Chọn lead #${r.code}`} className="size-4" />
                  </td>
                )}
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/leads/${r.id}`} className="font-semibold text-primary hover:underline">
                    #{r.code}
                  </Link>{' '}
                  <PriorityBadge priority={r.priority} />
                  {r.isRepurchase && <span className="ml-1 text-xs text-muted-foreground">mua lại</span>}
                </td>
                <td className="max-w-64 px-3 py-2">
                  <Link href={`/leads/${r.id}`} className="block truncate font-medium hover:underline">
                    {r.contactName}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">{[r.shopName, r.province].filter(Boolean).join(' · ')}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.phone ? toLocalVnPhone(r.phone) : '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{LEAD_SOURCE_LABELS[r.source]}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-0.5">
                    <LeadStatusBadge status={r.status} />
                    <SlaCell row={r} />
                  </div>
                </td>
                {showOwner && <td className="px-3 py-2 whitespace-nowrap">{r.ownerName ?? <span className="text-muted-foreground">Chưa giao</span>}</td>}
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(new Date(r.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor && (
        <Button variant="outline" onClick={loadMore} disabled={loading} className="self-center">
          {loading ? 'Đang tải…' : 'Tải thêm'}
        </Button>
      )}
    </div>
  );
}
