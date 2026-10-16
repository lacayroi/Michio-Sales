// Working hours (SPEC A1 [CẦN XÁC NHẬN] → editable without code, 0.1.4; 6.12) and staff leave
// (6.1 trạng thái OFF có ngày bắt đầu/kết thúc; §8 CRUD /users/:id/leaves). Both feed lead
// assignment: SLAs are counted in working hours and people on leave are not offered leads.
import { assertAuthorized } from '@michio/auth';
import type { Prisma } from '@michio/db';
import { z } from 'zod';
import { reclaimPendingForUser } from './assignment';
import { recordAudit } from './audit';
import type { WeeklyDay } from './business-time';
import { DEFAULT_WEEKLY } from './calendar';
import { type ServiceContext, TX_OPTIONS } from './context';
import { DomainError, notFound } from './errors';

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:mm');

export const WorkingCalendarInput = z.object({
  weekly: z
    .array(z.object({ dow: z.number().int().min(0).max(6), ranges: z.array(z.tuple([HHMM, HHMM])).min(1).max(4) }))
    .max(7)
    .superRefine((days, issue) => {
      if (!days.length) issue.addIssue({ code: 'custom', message: 'Cần ít nhất một ngày làm việc' });
      if (new Set(days.map((d) => d.dow)).size !== days.length) issue.addIssue({ code: 'custom', message: 'Mỗi thứ chỉ khai báo một lần' });
      for (const d of days) {
        let prev = '00:00';
        for (const [s, e] of d.ranges) {
          if (s >= e || s < prev) issue.addIssue({ code: 'custom', message: 'Khung giờ phải tăng dần và không chồng nhau' });
          prev = e;
        }
      }
    }),
});

export async function getWorkingCalendar(ctx: ServiceContext): Promise<WeeklyDay[]> {
  const cal = await ctx.db.workingCalendar.findUnique({ where: { orgId: ctx.orgId } });
  return (cal?.weekly as WeeklyDay[] | undefined) ?? DEFAULT_WEEKLY;
}

export async function setWorkingCalendar(ctx: ServiceContext, raw: z.input<typeof WorkingCalendarInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'settings.manage');
  const { weekly } = WorkingCalendarInput.parse(raw);
  const value = [...weekly].sort((a, b) => a.dow - b.dow) as unknown as Prisma.InputJsonValue;
  const before = await getWorkingCalendar(ctx);
  await ctx.db.$transaction([
    ctx.db.workingCalendar.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, weekly: value }, update: { weekly: value } }),
    recordAudit(ctx.db, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'settings.workingCalendar', entityType: 'WorkingCalendar', entityId: ctx.orgId,
      before: before as unknown as Prisma.InputJsonValue, after: value, ip: ctx.ip,
    }),
  ]);
  return value;
}

// ---------- leaves ----------

export const LeaveInput = z
  .object({
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.endAt > v.startAt, { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['endAt'] });

async function staffMember(ctx: ServiceContext, userId: string) {
  const u = await ctx.db.user.findFirst({ where: { id: userId, orgId: ctx.orgId, deletedAt: null } });
  if (!u) throw notFound('người dùng');
  return u;
}

export async function listLeaves(ctx: ServiceContext, userId: string, opts: { upcomingOnly?: boolean } = {}) {
  const actor = actorOf(ctx);
  if (actor.id !== userId) assertAuthorized(actor, 'user.manage');
  await staffMember(ctx, userId);
  return ctx.db.userLeave.findMany({
    where: { userId, ...(opts.upcomingOnly ? { endAt: { gt: ctx.now() } } : {}) },
    orderBy: { startAt: 'asc' },
  });
}

/** Owner records leave. A leave that is already running also hands back leads still waiting for this person. */
export async function addLeave(ctx: ServiceContext, userId: string, raw: z.input<typeof LeaveInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'user.manage');
  const input = LeaveInput.parse(raw);
  const user = await staffMember(ctx, userId);
  const leave = await ctx.db.$transaction(async (tx) => {
    const overlap = await tx.userLeave.findFirst({ where: { userId, startAt: { lt: input.endAt }, endAt: { gt: input.startAt } } });
    if (overlap) throw new DomainError('CONFLICT', 'Trùng với một lịch nghỉ đã có');
    const l = await tx.userLeave.create({ data: { userId, startAt: input.startAt, endAt: input.endAt, reason: input.reason ?? null } });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'user.leave.create', entityType: 'User', entityId: userId,
      after: { leaveId: l.id, startAt: l.startAt.toISOString(), endAt: l.endAt.toISOString(), reason: l.reason }, ip: ctx.ip,
    });
    return l;
  }, TX_OPTIONS);
  const now = ctx.now();
  if (leave.startAt <= now && leave.endAt > now && user.role === 'SALES') await reclaimPendingForUser(ctx, userId, 'Người nhận đang nghỉ phép');
  return leave;
}

export async function deleteLeave(ctx: ServiceContext, userId: string, leaveId: string) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'user.manage');
  const leave = await ctx.db.userLeave.findFirst({ where: { id: leaveId, userId, user: { orgId: ctx.orgId } } });
  if (!leave) throw notFound('lịch nghỉ');
  await ctx.db.$transaction([
    ctx.db.userLeave.delete({ where: { id: leaveId } }),
    recordAudit(ctx.db, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'user.leave.delete', entityType: 'User', entityId: userId,
      before: { leaveId, startAt: leave.startAt.toISOString(), endAt: leave.endAt.toISOString(), reason: leave.reason }, ip: ctx.ip,
    }),
  ]);
}
