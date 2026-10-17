import { listAuditLogs } from '@michio/core';
import { formatDateTime } from '@michio/shared';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Audit log' };

type SP = Record<string, string | undefined>;
const VIA: Record<string, string> = { WEB: 'Web', ZALO_BOT: 'Zalo Bot', API: 'API', SYSTEM: 'Hệ thống' };

/** Short "trước → sau" for the changed keys; full JSON on demand. */
function diff(before: unknown, after: unknown) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].slice(0, 6);
  const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));
  return keys.map((k) => (k in b && k in a ? `${k}: ${show(b[k])} → ${show(a[k])}` : k in a ? `${k}: ${show(a[k])}` : `${k}: ${show(b[k])} → ∅`));
}

/** S19 — nhật ký thao tác, chỉ đọc (SPEC 6.12; bảng chỉ-ghi-thêm ở tầng DB, D-010). */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('auditLog.view');
  const sp = await searchParams;
  const day = (d?: string, plus = 0) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(new Date(`${d}T00:00:00+07:00`).getTime() + plus * 86_400_000).toISOString() : undefined);
  const r = await listAuditLogs(serviceContext(user), {
    entityType: sp.entityType || undefined, entityId: sp.entityId || undefined, action: sp.action || undefined, via: (sp.via || undefined) as never,
    from: day(sp.from), to: day(sp.to, 1), cursor: sp.cursor, limit: 50,
  });
  const next = r.nextCursor ? `?${new URLSearchParams({ ...(sp as Record<string, string>), cursor: r.nextCursor })}` : null;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <form className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3 lg:grid-cols-7" role="search" aria-label="Lọc audit log">
        <Select name="entityType" defaultValue={sp.entityType ?? ''} aria-label="Đối tượng"><option value="">Mọi đối tượng</option>{r.entityTypes.map((e) => <option key={e} value={e}>{e}</option>)}</Select>
        <Select name="action" defaultValue={sp.action ?? ''} aria-label="Hành động"><option value="">Mọi hành động</option>{r.actions.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
        <Select name="via" defaultValue={sp.via ?? ''} aria-label="Kênh"><option value="">Mọi kênh</option>{Object.entries(VIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input name="entityId" defaultValue={sp.entityId} placeholder="Mã bản ghi" aria-label="Mã bản ghi" />
        <Input type="date" name="from" defaultValue={sp.from} aria-label="Từ ngày" />
        <Input type="date" name="to" defaultValue={sp.to} aria-label="Đến ngày" />
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>Lọc</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[860px] text-sm" data-testid="audit-table">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Thời điểm</th><th className="p-3">Người làm</th><th className="p-3">Kênh</th><th className="p-3">Hành động</th><th className="p-3">Đối tượng</th><th className="p-3">Thay đổi</th></tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {r.items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Không có bản ghi</td></tr>}
            {r.items.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap p-3">{formatDateTime(a.createdAt)}</td>
                <td className="p-3">{a.actorId ? (r.actors[a.actorId] ?? 'Người dùng đã xóa') : 'Hệ thống'}{a.ip && <span className="block text-xs text-muted-foreground">{a.ip}</span>}</td>
                <td className="p-3">{VIA[a.via] ?? a.via}</td>
                <td className="p-3 font-mono text-xs">{a.action}</td>
                <td className="p-3 text-xs"><Link href={`/audit-log?entityId=${a.entityId}`} className="hover:underline">{a.entityType} · {a.entityId.slice(-8)}</Link></td>
                <td className="p-3 text-xs text-muted-foreground">
                  <ul>{diff(a.before, a.after).map((l) => <li key={l} className="break-all">{l}</li>)}</ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && <div className="flex justify-center"><Link href={next} className={buttonVariants({ variant: 'outline' })}>Trang sau →</Link></div>}
    </section>
  );
}
