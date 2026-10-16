'use client';

import { formatDateTime, LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';
import { useState } from 'react';
import { LeadStatusBadge, PriorityBadge } from '@/components/badges';
import { Countdown } from '@/components/countdown';
import { type AssignableUser, AssignButton } from '@/components/lead-actions';
import { PhoneActions } from '@/components/phone-actions';

export interface LeadRow {
  id: string;
  code: number;
  status: 'NEW' | 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'WON' | 'LOST';
  priority: 'HOT' | 'WARM' | 'COLD';
  source: keyof typeof LEAD_SOURCE_LABELS;
  createdAt: string;
  contactName: string;
  shopName: string | null;
  phone: string | null;
  province: string | null;
  ownerId: string | null;
  ownerName: string | null;
  acceptDeadline: string | null;
  overdue: boolean;
}

export function LeadTable({ rows, canAssign, users }: { rows: LeadRow[]; canAssign: boolean; users: AssignableUser[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const open = rows.filter((r) => r.status !== 'WON' && r.status !== 'LOST');
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">Không có lead nào phù hợp.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {canAssign && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={selected.length > 0 && selected.length === open.length}
              onChange={(e) => setSelected(e.target.checked ? open.map((r) => r.id) : [])}
              aria-label="Chọn tất cả lead đang mở"
            />
            Chọn tất cả ({open.length})
          </label>
          {selected.length > 0 && <AssignButton leadIds={selected} users={users} label={`Giao ${selected.length} lead…`} onDone={() => setSelected([])} />}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {canAssign && <th className="w-10 px-3 py-2"><span className="sr-only">Chọn</span></th>}
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">SĐT</th>
              <th className="px-3 py-2">Nguồn</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2">Phụ trách</th>
              <th className="px-3 py-2">Tạo lúc</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className={r.overdue ? 'bg-accent/5' : undefined} data-testid="lead-row">
                {canAssign && (
                  <td className="px-3 py-2">
                    {r.status !== 'WON' && r.status !== 'LOST' && (
                      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Chọn lead #${r.code}`} />
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <Link href={`/leads/${r.id}`} className="font-medium hover:underline">
                    #{r.code} · {r.contactName}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <PriorityBadge priority={r.priority} />
                    {[r.shopName, r.province].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-3 py-2"><PhoneActions phone={r.phone} compact /></td>
                <td className="px-3 py-2">{LEAD_SOURCE_LABELS[r.source]}</td>
                <td className="px-3 py-2">
                  <LeadStatusBadge status={r.status} />
                  {r.status === 'ASSIGNED' && r.acceptDeadline && (
                    <div className="text-xs"><Countdown deadline={r.acceptDeadline} /></div>
                  )}
                  {r.overdue && r.status === 'IN_PROGRESS' && <div className="text-xs font-semibold text-accent-text">Quá hạn liên hệ</div>}
                </td>
                <td className="px-3 py-2">{r.ownerName ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(new Date(r.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-xl border bg-surface p-3 ${r.overdue ? 'border-accent' : 'border-border'}`} data-testid="lead-card">
            <div className="flex items-start gap-2">
              {canAssign && r.status !== 'WON' && r.status !== 'LOST' && (
                <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Chọn lead #${r.code}`} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/leads/${r.id}`} className="truncate font-medium">#{r.code} · {r.contactName}</Link>
                  <LeadStatusBadge status={r.status} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{[r.shopName, r.province, LEAD_SOURCE_LABELS[r.source]].filter(Boolean).join(' · ')}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <PhoneActions phone={r.phone} compact />
                  <span className="flex items-center gap-2">
                    <PriorityBadge priority={r.priority} />
                    {r.status === 'ASSIGNED' && r.acceptDeadline ? <Countdown deadline={r.acceptDeadline} /> : <span className="text-muted-foreground">{r.ownerName ?? 'Chưa giao'}</span>}
                  </span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
