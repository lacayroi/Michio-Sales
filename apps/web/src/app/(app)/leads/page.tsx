import { can } from '@michio/auth/permissions';
import { listLeads, listUsers } from '@michio/core';
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, PRIORITY_LABELS } from '@michio/shared';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { LeadTable, type LeadRow } from './lead-table';

export const metadata = { title: 'Lead' };

type SP = Record<string, string | undefined>;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('lead.view');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const isManager = can(user.role, 'lead.assign');
  const [{ items, nextCursor }, users] = await Promise.all([
    listLeads(ctx, { ...sp, limit: 30 }),
    isManager ? listUsers(ctx) : Promise.resolve([]),
  ]);
  const now = Date.now();
  const rows: LeadRow[] = items.map((l) => ({
    id: l.id,
    code: l.code,
    status: l.status,
    priority: l.priority,
    source: l.source,
    createdAt: l.createdAt.toISOString(),
    contactName: l.customer.contactName,
    shopName: l.customer.shopName,
    phone: l.customer.phone,
    province: l.customer.province,
    ownerId: l.owner?.id ?? null,
    ownerName: l.owner?.fullName ?? null,
    acceptDeadline: l.assignments[0]?.acceptDeadline?.toISOString() ?? null,
    overdue:
      (l.assignments[0]?.acceptDeadline ? l.assignments[0].acceptDeadline.getTime() < now : false) ||
      (l.status === 'IN_PROGRESS' && !l.firstContactAt && !!l.firstContactDeadline && l.firstContactDeadline.getTime() < now),
  }));
  const next = nextCursor ? `?${new URLSearchParams({ ...(sp as Record<string, string>), cursor: nextCursor })}` : null;
  const filtered = Object.entries(sp).some(([k, v]) => k !== 'cursor' && v);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Lead</h1>
      </div>

      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6" role="search" aria-label="Lọc lead">
        <Input name="q" defaultValue={sp.q} placeholder="Tên, shop, SĐT, mã lead" aria-label="Tìm kiếm" className="col-span-2 sm:col-span-3 lg:col-span-2" />
        <Select name="status" defaultValue={sp.status ?? ''} aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          <option value="NEW,UNASSIGNED,ASSIGNED,IN_PROGRESS">Đang mở</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select name="source" defaultValue={sp.source ?? ''} aria-label="Nguồn">
          <option value="">Mọi nguồn</option>
          {Object.entries(LEAD_SOURCE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select name="priority" defaultValue={sp.priority ?? ''} aria-label="Mức ưu tiên">
          <option value="">Mọi mức</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        {isManager ? (
          <Select name="ownerId" defaultValue={sp.ownerId ?? ''} aria-label="Người phụ trách">
            <option value="">Mọi sales</option>
            <option value="none">Chưa có người</option>
            {users.filter((u) => u.status !== 'INACTIVE' && u.role !== 'VIEWER' && u.role !== 'SUPPORT').map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </Select>
        ) : (
          <span className="hidden lg:block" />
        )}
        <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-1">
          <input type="checkbox" name="slaBreached" value="true" defaultChecked={sp.slaBreached === 'true'} className="size-4 accent-[var(--primary)]" />
          Quá hạn / chờ giao
        </label>
        <div className="col-span-2 flex gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className={buttonVariants({ size: 'md', className: 'flex-1' })}>Lọc</button>
          {filtered && <Link href="/leads" className={buttonVariants({ variant: 'ghost' })}>Xóa lọc</Link>}
        </div>
      </form>

      <LeadTable rows={rows} canAssign={isManager} users={users.map((u) => ({ id: u.id, fullName: u.fullName, role: u.role, status: u.status, openLeads: u.openLeads, maxOpenLeads: u.maxOpenLeads }))} />

      {next && (
        <div className="mt-4 flex justify-center">
          <Link href={next} className={buttonVariants({ variant: 'outline' })} scroll={false}>
            Trang sau →
          </Link>
        </div>
      )}
    </section>
  );
}
