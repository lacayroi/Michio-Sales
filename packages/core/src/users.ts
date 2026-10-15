// User administration (SPEC 6.1, S16) and password changes.
import { randomInt } from 'node:crypto';
import { assertAuthorized, hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from '@michio/auth';
import { normalizeVnPhone } from '@michio/shared';
import { z } from 'zod';
import { reclaimPendingForUser } from './assignment';
import { recordAudit } from './audit';
import type { ServiceContext } from './context';
import { DomainError, notFound } from './errors';

const ROLES = ['OWNER', 'MANAGER', 'SALES', 'SUPPORT', 'VIEWER'] as const;
// Without look-alike characters (0/O, 1/l/I) so a temp password can be read out over the phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generateTempPassword(length = 10): string {
  for (;;) {
    const pw = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    if (/\d/.test(pw) && /[a-z]/.test(pw) && /[A-Z]/.test(pw)) return pw;
  }
}

const RANK: Record<(typeof ROLES)[number], number> = { OWNER: 3, MANAGER: 2, SALES: 1, SUPPORT: 1, VIEWER: 1 };

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  return ctx.actor;
}

function phoneOrThrow(raw: string | null | undefined) {
  if (!raw) return null;
  const p = normalizeVnPhone(raw);
  if (!p) throw new DomainError('VALIDATION_ERROR', 'Số điện thoại không hợp lệ', { phone: ['Số điện thoại không hợp lệ'] });
  return p;
}

export const UserCreateInput = z.object({
  email: z.email('Email không hợp lệ').transform((e) => e.toLowerCase()),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().nullable(),
  role: z.enum(ROLES),
  maxOpenLeads: z.number().int().min(1).max(1000).default(40),
});

export async function createUser(ctx: ServiceContext, raw: z.input<typeof UserCreateInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'user.manage');
  const input = UserCreateInput.parse(raw);
  const phone = phoneOrThrow(input.phone);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  return ctx.db.$transaction(async (tx) => {
    if (await tx.user.findFirst({ where: { orgId: ctx.orgId, email: input.email } })) throw new DomainError('CONFLICT', 'Email đã được dùng');
    if (phone && (await tx.user.findFirst({ where: { orgId: ctx.orgId, phone, deletedAt: null } }))) throw new DomainError('CONFLICT', 'SĐT đã được dùng');
    const user = await tx.user.create({
      data: { orgId: ctx.orgId, email: input.email, fullName: input.fullName, phone, role: input.role, maxOpenLeads: input.maxOpenLeads, passwordHash, mustChangePassword: true },
    });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'user.create', entityType: 'User', entityId: user.id,
      after: { email: user.email, role: user.role, maxOpenLeads: user.maxOpenLeads }, ip: ctx.ip,
    });
    return { user, tempPassword };
  });
}

export const UserUpdateInput = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['AVAILABLE', 'BUSY', 'OFF', 'INACTIVE']).optional(),
  maxOpenLeads: z.number().int().min(1).max(1000).optional(),
});

export async function updateUser(ctx: ServiceContext, userId: string, raw: z.input<typeof UserUpdateInput>) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'user.manage');
  const input = UserUpdateInput.parse(raw);
  if (userId === actor.id && (input.role || input.status === 'INACTIVE')) {
    throw new DomainError('VALIDATION_ERROR', 'Không thể tự đổi vai trò hoặc tự khóa tài khoản của mình');
  }
  const phone = input.phone === undefined ? undefined : phoneOrThrow(input.phone);
  const updated = await ctx.db.$transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, orgId: ctx.orgId, deletedAt: null } });
    if (!u) throw notFound('người dùng');
    const next = await tx.user.update({ where: { id: u.id }, data: { ...input, phone } });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: input.status === 'INACTIVE' ? 'user.deactivate' : 'user.update', entityType: 'User', entityId: u.id,
      before: { fullName: u.fullName, phone: u.phone, role: u.role, status: u.status, maxOpenLeads: u.maxOpenLeads },
      after: { fullName: next.fullName, phone: next.phone, role: next.role, status: next.status, maxOpenLeads: next.maxOpenLeads }, ip: ctx.ip,
    });
    return next;
  });
  // Leads still waiting for someone who left must not sit until their SLA expires.
  if (input.status === 'INACTIVE') await reclaimPendingForUser(ctx, userId);
  return updated;
}

/**
 * "Đặt lại mật khẩu" (SPEC 6.1): issues a temporary password the user must change at next login.
 * Managers cannot reset Owner/Manager accounts; nobody resets their own password here.
 */
export async function resetUserPassword(ctx: ServiceContext, userId: string) {
  const actor = actorOf(ctx);
  assertAuthorized(actor, 'user.resetPassword');
  if (userId === actor.id) throw new DomainError('VALIDATION_ERROR', 'Hãy dùng "Đổi mật khẩu" trong Hồ sơ để đổi mật khẩu của bạn');
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await ctx.db.$transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, orgId: ctx.orgId, deletedAt: null } });
    if (!u) throw notFound('người dùng');
    if (actor.role !== 'OWNER' && RANK[u.role] >= RANK[actor.role]) {
      throw new DomainError('VALIDATION_ERROR', 'Chỉ chủ doanh nghiệp mới đặt lại được mật khẩu của tài khoản này');
    }
    await tx.user.update({ where: { id: u.id }, data: { passwordHash, mustChangePassword: true } });
    await recordAudit(tx, {
      orgId: ctx.orgId, actorId: actor.id, via: ctx.via, action: 'user.reset_password', entityType: 'User', entityId: u.id,
      after: { mustChangePassword: true }, ip: ctx.ip, // never log the password itself
    });
  });
  return { tempPassword };
}

export const ChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, `Mật khẩu mới tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`).max(200),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'Mật khẩu mới phải khác mật khẩu hiện tại', path: ['newPassword'] });

export async function changeOwnPassword(ctx: ServiceContext, raw: z.input<typeof ChangePasswordInput>) {
  const actor = actorOf(ctx);
  const input = ChangePasswordInput.parse(raw);
  const u = await ctx.db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(u.passwordHash, input.currentPassword))) {
    throw new DomainError('VALIDATION_ERROR', 'Mật khẩu hiện tại không đúng', { currentPassword: ['Mật khẩu hiện tại không đúng'] });
  }
  const passwordHash = await hashPassword(input.newPassword);
  await ctx.db.$transaction([
    ctx.db.user.update({ where: { id: u.id }, data: { passwordHash, mustChangePassword: false } }),
    recordAudit(ctx.db, { orgId: ctx.orgId, actorId: u.id, via: ctx.via, action: 'user.change_password', entityType: 'User', entityId: u.id, ip: ctx.ip }),
  ]);
}
