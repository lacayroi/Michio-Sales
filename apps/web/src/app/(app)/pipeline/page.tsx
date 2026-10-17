import { can } from '@michio/auth/permissions';
import { getPipeline, listUsers } from '@michio/core';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { Board } from './board';

export const metadata = { title: 'Pipeline' };

/** S7 — Kanban kéo-thả + dạng bảng (SPEC 6.5). */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('deal.view');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const manager = can(user.role, 'lead.assign');
  const [board, users] = await Promise.all([getPipeline(ctx, { ownerId: sp.ownerId, q: sp.q }), manager ? listUsers(ctx) : Promise.resolve([])]);
  return (
    <Board
      columns={board.columns.map((c) => ({ ...c, cards: c.cards.map((k) => ({ ...k, updatedAt: k.updatedAt.toISOString(), closedAt: k.closedAt?.toISOString() ?? null })) }))}
      lostReasons={board.lostReasons}
      canMove={can(user.role, 'deal.update')}
      sales={users.filter((u) => u.role === 'SALES' || u.role === 'OWNER' || u.role === 'MANAGER').map((u) => ({ id: u.id, fullName: u.fullName }))}
      filters={{ ownerId: sp.ownerId ?? '', q: sp.q ?? '', view: sp.view === 'table' ? 'table' : 'board' }}
    />
  );
}
