import { getSettings, listUsers } from '@michio/core';
import { prisma } from '@michio/db';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { RulesEditor } from './rules-editor';

export const metadata = { title: 'Chia lead' };

export default async function AssignmentRulesPage() {
  const user = await requireUser('assignmentRule.manage');
  const ctx = serviceContext(user);
  const [rules, users, settings] = await Promise.all([
    prisma.assignmentRule.findMany({ where: { orgId: user.orgId }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] }),
    listUsers(ctx),
    getSettings(prisma, user.orgId, ['sla.businessHoursOnly', 'assignment.outOfHoursMode', 'assignment.keepCustomerOwner', 'assignment.preferPreviousOwner', 'assignment.reclaimOnContactSlaBreach', 'priority.byOrderBand']),
  ]);
  return (
    <section className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold">Chia lead</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Lead mới đi qua các luật từ trên xuống; luật đầu tiên khớp sẽ quyết định ai nhận. Luật cuối cùng là mặc định. Thời hạn tính theo giờ làm việc (T2–T7, trừ ngày lễ).
      </p>
      <RulesEditor
        rules={rules.map((r) => ({ ...r, conditions: r.conditions as Record<string, unknown>, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), weightState: null }))}
        users={users.filter((u) => u.status !== 'INACTIVE' && ['SALES', 'OWNER', 'MANAGER'].includes(u.role)).map((u) => ({ id: u.id, fullName: u.fullName, role: u.role, status: u.status, openLeads: u.openLeads, maxOpenLeads: u.maxOpenLeads }))}
        settings={settings}
      />
    </section>
  );
}
