// Candidate filtering (SPEC 6.3.3): not AVAILABLE, on leave, at maxOpenLeads, or previously
// returned/reclaimed this lead → excluded.
import type { Db, Tx } from '../context';

export type IneligibleReason = 'INACTIVE' | 'NOT_AVAILABLE' | 'ON_LEAVE' | 'AT_CAPACITY' | 'EXCLUDED' | 'NOT_FOUND';

export const INELIGIBLE_LABELS: Record<IneligibleReason, string> = {
  INACTIVE: 'Đã nghỉ việc / bị khóa',
  NOT_AVAILABLE: 'Đang bận hoặc tạm dừng nhận lead',
  ON_LEAVE: 'Đang nghỉ phép',
  AT_CAPACITY: 'Đã đủ số lead đang mở tối đa',
  EXCLUDED: 'Đã trả lại / bị thu hồi lead này',
  NOT_FOUND: 'Không tìm thấy người dùng',
};

export interface CandidateFacts {
  id: string;
  fullName: string;
  status: 'AVAILABLE' | 'BUSY' | 'OFF' | 'INACTIVE';
  deletedAt: Date | null;
  maxOpenLeads: number;
  openLeads: number;
  onLeave: boolean;
}

export function ineligibleReason(c: CandidateFacts, exclude: ReadonlySet<string>): IneligibleReason | null {
  if (c.status === 'INACTIVE' || c.deletedAt) return 'INACTIVE';
  if (exclude.has(c.id)) return 'EXCLUDED';
  if (c.onLeave) return 'ON_LEAVE';
  if (c.status !== 'AVAILABLE') return 'NOT_AVAILABLE';
  if (c.openLeads >= c.maxOpenLeads) return 'AT_CAPACITY';
  return null;
}

/** Lead statuses that count towards a sales person's open load. */
export const LOAD_LEAD_STATUSES = ['ASSIGNED', 'IN_PROGRESS'] as const;

export async function loadCandidateFacts(tx: Db | Tx, orgId: string, userIds: readonly string[], now: Date): Promise<Map<string, CandidateFacts>> {
  if (!userIds.length) return new Map();
  const [users, loads] = await Promise.all([
    tx.user.findMany({
      where: { orgId, id: { in: [...userIds] } },
      select: {
        id: true,
        fullName: true,
        status: true,
        deletedAt: true,
        maxOpenLeads: true,
        leaves: { where: { startAt: { lte: now }, endAt: { gt: now } }, select: { id: true }, take: 1 },
      },
    }),
    tx.lead.groupBy({
      by: ['ownerId'],
      where: { orgId, ownerId: { in: [...userIds] }, status: { in: [...LOAD_LEAD_STATUSES] }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const load = new Map(loads.map((l) => [l.ownerId!, l._count._all]));
  return new Map(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        fullName: u.fullName,
        status: u.status,
        deletedAt: u.deletedAt,
        maxOpenLeads: u.maxOpenLeads,
        openLeads: load.get(u.id) ?? 0,
        onLeave: u.leaves.length > 0,
      },
    ]),
  );
}

/** Active SALES users — the pool when a rule has no explicit targets. */
export async function defaultTargets(tx: Db | Tx, orgId: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { orgId, role: 'SALES', deletedAt: null, status: { not: 'INACTIVE' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
