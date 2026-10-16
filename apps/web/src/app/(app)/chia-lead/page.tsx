import { listRules, loadSettings } from '@michio/core';
import { prisma } from '@michio/db';
import { Card, CardTitle } from '@/components/ui/card';
import { navItem } from '@/lib/nav';
import { requireUser } from '@/lib/session';
import { AssignmentSettings } from './assignment-settings';
import { RulesEditor, type RuleView } from './rules-editor';
import { Simulator } from './simulator';

const HREF = '/chia-lead';
export const metadata = { title: navItem(HREF).label };

export default async function AssignmentRulesPage() {
  const user = await requireUser('assignmentRule.manage');
  const actor = { orgId: user.orgId, user, via: 'WEB' as const };
  const [rules, settings, users] = await Promise.all([
    listRules(prisma, actor),
    loadSettings(prisma, user.orgId),
    prisma.user.findMany({
      where: { orgId: user.orgId, deletedAt: null, status: { not: 'INACTIVE' }, role: { in: ['SALES', 'OWNER', 'MANAGER'] } },
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, fullName: true, role: true, status: true },
    }),
  ]);
  const views: RuleView[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.isActive,
    method: r.method as RuleView['method'],
    targetUserIds: r.targetUserIds,
    conditions: (r.conditions ?? {}) as RuleView['conditions'],
    autoAccept: r.autoAccept,
    acceptSlaMinutes: r.acceptSlaMinutes,
    hotAcceptSlaMinutes: r.hotAcceptSlaMinutes,
    firstContactSlaMinutes: r.firstContactSlaMinutes,
    maxReassign: r.maxReassign,
    fallback: r.fallback,
    weights: ((r.weightState as { weights?: Record<string, number> } | null)?.weights ?? {}) as Record<string, number>,
  }));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Chia lead</h1>
        <p className="text-sm text-muted-foreground">
          Luật được xét từ trên xuống; lead khớp luật đầu tiên. Luật không có điều kiện là luật mặc định. Thời hạn tính theo giờ làm việc.
        </p>
      </div>
      <RulesEditor rules={views} users={users.map((u) => ({ id: u.id, fullName: u.fullName, role: u.role, status: u.status }))} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Cài đặt chia lead</CardTitle>
          <AssignmentSettings
            initial={{
              'sla.businessHoursOnly': settings['sla.businessHoursOnly'],
              'assignment.outOfHoursMode': settings['assignment.outOfHoursMode'],
              'assignment.keepCustomerOwner': settings['assignment.keepCustomerOwner'],
              'assignment.preferPreviousOwner': settings['assignment.preferPreviousOwner'],
              'assignment.reclaimOnContactSlaBreach': settings['assignment.reclaimOnContactSlaBreach'],
              'priority.byOrderBand': settings['priority.byOrderBand'],
            }}
          />
        </Card>
        <Card>
          <CardTitle>Thử luật</CardTitle>
          <Simulator />
        </Card>
      </div>
    </section>
  );
}
