// Zalo Bot command handling (SPEC 5.5). Every command runs the same service as the web, with the
// linked user as actor and via = 'ZALO_BOT', so permissions and AuditLog are identical.
// Returns reply texts; sending them is the caller's job (packages/channels, CLAUDE.md).
import { type AuthUser, authorize, ForbiddenError } from '@michio/auth';
import type { ZaloBotUpdate } from '@michio/channels';
import { formatDateTime, toLocalVnPhone } from '@michio/shared';
import { z } from 'zod';
import { acceptLead, returnLead } from './assignment';
import { linkBotChat } from './bot-account';
import { BOT_HELP, type BotCommand, parseBotCommand } from './bot-commands';
import { recordAudit } from './audit';
import type { Effects, ServiceContext } from './context';
import { DomainError } from './errors';
import { addLeadActivity, intakeLead } from './leads';
import { changeLeadStage } from './lead-stage';
import { completeTask, createTask, describeTask, guessTaskType, tasksDueToday } from './tasks';

export interface BotRuntime {
  db: ServiceContext['db'];
  effects: Effects;
  now: () => Date;
}

const NOT_LINKED =
  '👋 Chào bạn! Đây là bot nội bộ của Michio Sales Hub.\nĐể dùng bot: mở Sales Hub → Hồ sơ → "Kết nối Zalo Bot", rồi gửi mã 6 số vào đây.';

async function leadByCode(ctx: ServiceContext, actor: AuthUser, code: number) {
  const lead = await ctx.db.lead.findFirst({
    where: { orgId: ctx.orgId, code, deletedAt: null },
    include: { customer: { select: { contactName: true, shopName: true, phone: true, province: true } } },
  });
  // A sales sees a lead offered to them even before accepting it.
  const offered = lead && (await ctx.db.leadAssignment.count({ where: { leadId: lead.id, userId: actor.id, status: 'PENDING' } }));
  if (!lead || !(authorize(actor, 'lead.view', lead) || offered)) throw new DomainError('NOT_FOUND', `Không tìm thấy lead #${code} của bạn`);
  return lead;
}

async function setWorkingStatus(ctx: ServiceContext, actor: AuthUser, next: 'AVAILABLE' | 'BUSY') {
  const user = await ctx.db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.status === 'OFF') return '🌴 Bạn đang ở trạng thái nghỉ phép — liên hệ quản lý để đổi.';
  if (user.status === next) return next === 'BUSY' ? '⏸️ Bạn đang tạm dừng nhận lead rồi.' : '▶️ Bạn đang nhận lead bình thường.';
  await ctx.db.$transaction([
    ctx.db.user.update({ where: { id: actor.id }, data: { status: next } }),
    recordAudit(ctx.db, { orgId: ctx.orgId, actorId: actor.id, via: 'ZALO_BOT', action: 'user.status', entityType: 'User', entityId: actor.id, before: { status: user.status }, after: { status: next } }),
  ]);
  return next === 'BUSY' ? '⏸️ Đã tạm dừng nhận lead mới. Nhắn LAMVIEC để nhận lại.' : '▶️ Đã bật nhận lead. Lead mới sẽ được chia cho bạn theo lượt.';
}

async function today(ctx: ServiceContext, actor: AuthUser & { fullName: string }) {
  const now = ctx.now();
  const [pending, toContact, tasks] = await Promise.all([
    ctx.db.leadAssignment.findMany({
      where: { userId: actor.id, status: 'PENDING', lead: { deletedAt: null } },
      orderBy: { acceptDeadline: 'asc' },
      include: { lead: { include: { customer: { select: { contactName: true } } } } },
    }),
    ctx.db.lead.findMany({ where: { ownerId: actor.id, status: 'IN_PROGRESS', firstContactAt: null, deletedAt: null }, include: { customer: { select: { contactName: true } } }, take: 10 }),
    tasksDueToday(ctx, actor.id),
  ]);
  const lines = [`📋 Hôm nay của ${actor.fullName}:`];
  lines.push(pending.length ? `Lead chờ nhận (${pending.length}):` : 'Không có lead chờ nhận.');
  for (const a of pending.slice(0, 8)) lines.push(`  – #${a.lead.code} ${a.lead.customer.contactName}${a.acceptDeadline ? `, hạn ${formatDateTime(a.acceptDeadline).slice(11)}` : ''} → NHAN ${a.lead.code}`);
  if (toContact.length) {
    lines.push(`Lead chưa liên hệ (${toContact.length}):`);
    for (const l of toContact.slice(0, 8)) lines.push(`  – #${l.code} ${l.customer.contactName} → GOI ${l.code}`);
  }
  lines.push(tasks.length ? `Việc đến hạn (${tasks.length}):` : 'Không có việc đến hạn hôm nay.');
  for (const t of tasks.slice(0, 10)) lines.push(`  – ${t.dueAt < now ? '⚠️ ' : ''}${describeTask(t)}`);
  return lines.join('\n');
}

async function execute(ctx: ServiceContext, actor: AuthUser & { fullName: string }, cmd: BotCommand): Promise<string> {
  switch (cmd.kind) {
    case 'HELP':
      return BOT_HELP;
    case 'UNKNOWN':
      return '🤔 Bot chưa hiểu tin nhắn này. Gõ HELP để xem danh sách lệnh.';
    case 'INVALID':
      return `⚠️ ${cmd.message}`;
    case 'LINK':
      return '✅ Tài khoản Zalo này đã được kết nối. Gõ HELP để xem lệnh.';
    case 'LEAD': {
      // Người trực Zalo công ty: lead đi vào luật chia như mọi nguồn (SPEC 5.3 chế độ A).
      const r = await intakeLead(ctx, { source: 'ZALO_COMPANY', fullName: cmd.name, phone: cmd.phone, need: cmd.note ?? undefined, assignMode: 'AUTO' });
      if (r.duplicate) return `ℹ️ Khách đã có lead đang mở #${r.code}${r.assignedTo ? ` (phụ trách: ${r.assignedTo})` : ''}. Đã ghi nhận "liên hệ lại".`;
      const to = r.assignment?.status === 'ASSIGNED' ? r.assignment : null;
      if (!to) return `✅ Đã tạo lead #${r.code} · ${cmd.name}. Chưa có sales nhận được — đã báo quản lý giao tay.`;
      return `✅ Đã tạo lead #${r.code} · ${cmd.name} → ${to.userId === actor.id ? 'bạn' : to.userName}${to.acceptDeadline ? ` (hạn nhận ${formatDateTime(to.acceptDeadline).slice(11)})` : ''}.`;
    }
    case 'NHAN': {
      const lead = await leadByCode(ctx, actor, cmd.code);
      const r = await acceptLead(ctx, lead.id);
      const c = lead.customer;
      return [
        `✅ Đã nhận lead #${lead.code} · ${c.contactName}`,
        [c.phone && `📞 ${toLocalVnPhone(c.phone)}`, c.shopName, c.province].filter(Boolean).join(' · '),
        r.firstContactDeadline ? `Liên hệ trước ${formatDateTime(r.firstContactDeadline)}. Gọi xong nhắn: GOI ${lead.code}` : `Gọi xong nhắn: GOI ${lead.code}`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'TRA': {
      const lead = await leadByCode(ctx, actor, cmd.code);
      await returnLead(ctx, lead.id, cmd.reason ?? undefined);
      return `↩️ Đã trả lead #${lead.code}. Lead được chia cho người kế tiếp.`;
    }
    case 'GOI': {
      const lead = await leadByCode(ctx, actor, cmd.code);
      // Calling the customer implies taking the lead (SPEC 6.3.4 onFirstContact).
      if (lead.status === 'ASSIGNED') await acceptLead(ctx, lead.id);
      await addLeadActivity(ctx, lead.id, { type: 'CALL', note: cmd.note ?? undefined });
      return `📞 Đã ghi nhận liên hệ lead #${lead.code} · ${lead.customer.contactName}${lead.firstContactAt ? '' : ' (liên hệ đầu tiên)'}.`;
    }
    case 'HEN': {
      const lead = await leadByCode(ctx, actor, cmd.code);
      if (cmd.dueAt.getTime() < ctx.now().getTime() - 60_000) return '⚠️ Thời gian hẹn đã qua. Cách dùng: HEN <mã> <dd/mm hh:mm> <nội dung>';
      const task = await createTask(ctx, { title: cmd.content, type: guessTaskType(cmd.content), dueAt: cmd.dueAt, leadId: lead.id });
      return `📌 Đã hẹn ${formatDateTime(task.dueAt)}: ${task.title} (lead #${lead.code}) — việc V${task.code}.\nBot sẽ nhắc trước ${task.remindBeforeMinutes} phút. Xong nhắn: XONG ${task.code}`;
    }
    case 'XONG': {
      const task = await completeTask(ctx, { code: cmd.taskCode });
      return `☑️ Đã xong việc V${task.code}: ${task.title}`;
    }
    case 'HOMNAY':
      return today(ctx, actor);
    case 'TRANGTHAI': {
      const lead = await leadByCode(ctx, actor, cmd.code);
      const r = await changeLeadStage(ctx, lead.id, cmd.stage, cmd.reason);
      if (r.stage.isWon) return `🎉 Lead #${lead.code} → ${r.stage.name}. Nhớ ghi nhận đơn sỉ trên Sales Hub.`;
      if (r.stage.isLost) return `🏷️ Lead #${lead.code} → ${r.stage.name} (lý do: ${r.lostReason ?? 'Khác'}).`;
      return `🏷️ Lead #${lead.code} → ${r.stage.name}.`;
    }
    case 'NGHI':
      return setWorkingStatus(ctx, actor, 'BUSY');
    case 'LAMVIEC':
      return setWorkingStatus(ctx, actor, 'AVAILABLE');
  }
}

/** Handle one inbound bot message; returns the replies to send to `update.chatId`. */
export async function handleBotUpdate(rt: BotRuntime, update: ZaloBotUpdate): Promise<string[]> {
  const now = rt.now();
  const user = await rt.db.user.findUnique({ where: { zaloBotChatId: update.chatId } });
  const text = update.eventName === 'message.text.received' ? (update.text ?? '') : '';
  const cmd = parseBotCommand(text, now);

  if (cmd.kind === 'LINK') {
    const r = await linkBotChat(rt.db, cmd.code, update.chatId, now);
    if (!r.ok) return [`❌ ${r.reason}`];
    return [`✅ Đã kết nối Zalo với tài khoản ${r.user.fullName}. Từ giờ bạn sẽ nhận thông báo lead và nhắc việc tại đây.`, BOT_HELP];
  }
  if (!user) return [NOT_LINKED];
  if (user.deletedAt || user.status === 'INACTIVE') return ['⛔ Tài khoản đã bị khóa. Liên hệ quản lý.'];
  if (!text) return ['Bot chỉ hiểu tin nhắn chữ. Gõ HELP để xem lệnh.'];

  const actor = { id: user.id, orgId: user.orgId, role: user.role, status: user.status, deletedAt: user.deletedAt, fullName: user.fullName };
  const ctx: ServiceContext = { db: rt.db, effects: rt.effects, now: rt.now, actor, orgId: user.orgId, via: 'ZALO_BOT' };
  try {
    return [await execute(ctx, actor, cmd)];
  } catch (err) {
    if (err instanceof ForbiddenError) return ['⛔ Bạn không có quyền dùng lệnh này.'];
    if (err instanceof DomainError) return [`❌ ${err.message}`];
    if (err instanceof z.ZodError) return [`❌ ${err.issues[0]?.message ?? 'Dữ liệu không hợp lệ'}`];
    throw err;
  }
}
