// User administration (SPEC 6.1, §8 /users).
import { randomInt } from 'node:crypto';
import { assertAuthorized, hashPassword, PASSWORD_MIN_LENGTH, type Role, verifyPassword } from '@michio/auth';
import type { Prisma, UserStatus } from '@michio/db';
import { normalizeVnPhone } from '@michio/shared';
import { recordAudit } from '../audit';
import type { Actor, Db } from '../context';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../errors';

export const userPublicSelect = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  role: true,
  status: true,
  maxOpenLeads: true,
  lastLoginAt: true,
  mustChangePassword: true,
  zaloBotChatId: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export async function listUsers(db: Db, actor: Actor) {
  assertAuthorized(actor.user!, 'user.view');
  const now = new Date();
  return db.user.findMany({
    where: { orgId: actor.orgId, deletedAt: null },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    select: {
      ...userPublicSelect,
      leaves: { where: { endAt: { gt: now } }, orderBy: { startAt: 'asc' } },
      _count: { select: { ownedLeads: { where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] }, deletedAt: null } } } },
    },
  });
}

/** Readable temporary password: 10 chars, no ambiguous letters. */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

function validatePassword(p: string) {
  if (p.length < PASSWORD_MIN_LENGTH) throw new ValidationError(`Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự`, { password: ['Quá ngắn'] });
}

export interface UserInput {
  email: string;
  phone?: string | null;
  fullName: string;
  role: Role;
  maxOpenLeads?: number;
}

async function assertUnique(db: Db, orgId: string, email: string, phone: string | null, exceptId?: string) {
  const clash = await db.user.findFirst({
    where: { orgId, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}), OR: [{ email }, ...(phone ? [{ phone }] : [])] },
    select: { email: true },
  });
  if (clash) throw new ConflictError('USER_EXISTS', clash.email === email ? 'Email đã được dùng' : 'Số điện thoại đã được dùng');
}

/** Creates the account with a temporary password the user must change at first login. */
export async function createUser(db: Db, actor: Actor, input: UserInput) {
  assertAuthorized(actor.user!, 'user.manage');
  const email = input.email.trim().toLowerCase();
  const phone = input.phone ? normalizeVnPhone(input.phone) : null;
  if (input.phone && !phone) throw new ValidationError('Số điện thoại không hợp lệ', { phone: ['Số điện thoại không hợp lệ'] });
  await assertUnique(db, actor.orgId, email, phone);
  const tempPassword = generateTempPassword();
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        orgId: actor.orgId,
        email,
        phone,
        fullName: input.fullName.trim(),
        role: input.role,
        maxOpenLeads: input.maxOpenLeads ?? 40,
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
      },
      select: userPublicSelect,
    });
    await recordAudit(tx, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'user.create', entityType: 'User', entityId: u.id, after: { email, role: input.role }, ip: actor.ip });
    return u;
  });
  return { user, tempPassword };
}

export interface UserPatch {
  fullName?: string;
  email?: string;
  phone?: string | null;
  role?: Role;
  status?: UserStatus;
  maxOpenLeads?: number;
}

export async function updateUser(db: Db, actor: Actor, id: string, patch: UserPatch) {
  assertAuthorized(actor.user!, 'user.manage');
  const u = await db.user.findFirst({ where: { id, orgId: actor.orgId, deletedAt: null } });
  if (!u) throw new NotFoundError('Không tìm thấy người dùng');
  if (id === actor.user!.id && ((patch.role && patch.role !== u.role) || patch.status === 'INACTIVE')) {
    throw new DomainError('SELF_LOCKOUT', 'Không thể tự đổi vai trò hoặc khóa chính mình', 422);
  }
  const data: Prisma.UserUpdateInput = {};
  if (patch.fullName !== undefined) data.fullName = patch.fullName.trim();
  if (patch.email !== undefined) data.email = patch.email.trim().toLowerCase();
  if (patch.phone !== undefined) {
    const phone = patch.phone ? normalizeVnPhone(patch.phone) : null;
    if (patch.phone && !phone) throw new ValidationError('Số điện thoại không hợp lệ', { phone: ['Số điện thoại không hợp lệ'] });
    data.phone = phone;
  }
  if (data.email !== undefined || data.phone !== undefined) {
    await assertUnique(db, actor.orgId, (data.email as string | undefined) ?? u.email, (data.phone as string | null | undefined) ?? u.phone, id);
  }
  if (patch.role) data.role = patch.role;
  if (patch.status) data.status = patch.status;
  if (patch.maxOpenLeads !== undefined) {
    if (patch.maxOpenLeads < 1 || patch.maxOpenLeads > 1000) throw new ValidationError('Số lead mở tối đa từ 1 đến 1000');
    data.maxOpenLeads = patch.maxOpenLeads;
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id }, data, select: userPublicSelect });
    await recordAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.user!.id,
      via: actor.via,
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      before: { fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, status: u.status, maxOpenLeads: u.maxOpenLeads },
      after: { fullName: updated.fullName, email: updated.email, phone: updated.phone, role: updated.role, status: updated.status, maxOpenLeads: updated.maxOpenLeads },
      ip: actor.ip,
    });
    return updated;
  });
}

/** SPEC 6.10: đặt INACTIVE thu hồi đăng nhập ngay (sessions re-load the user per request). */
export function deactivateUser(db: Db, actor: Actor, id: string) {
  return updateUser(db, actor, id, { status: 'INACTIVE' });
}

/** SPEC 6.1: Owner/Manager "Đặt lại mật khẩu" → temp password, forced change at next login. */
export async function resetUserPassword(db: Db, actor: Actor, id: string) {
  assertAuthorized(actor.user!, 'user.resetPassword');
  const u = await db.user.findFirst({ where: { id, orgId: actor.orgId, deletedAt: null } });
  if (!u) throw new NotFoundError('Không tìm thấy người dùng');
  // A manager may not take over the owner's account.
  if (u.role === 'OWNER' && actor.user!.role !== 'OWNER') throw new DomainError('FORBIDDEN', 'Chỉ Chủ doanh nghiệp đặt lại mật khẩu cho tài khoản Chủ doanh nghiệp', 403);
  const tempPassword = generateTempPassword();
  await db.$transaction([
    db.user.update({ where: { id }, data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true } }),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'user.resetPassword', entityType: 'User', entityId: id, ip: actor.ip }),
  ]);
  return { tempPassword };
}

export async function changeOwnPassword(db: Db, actor: Actor, current: string, next: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.user!.id } });
  if (!(await verifyPassword(u.passwordHash, current))) throw new DomainError('INVALID_PASSWORD', 'Mật khẩu hiện tại không đúng', 422);
  validatePassword(next);
  if (current === next) throw new ValidationError('Mật khẩu mới phải khác mật khẩu cũ');
  await db.$transaction([
    db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } }),
    recordAudit(db, { orgId: u.orgId, actorId: u.id, via: actor.via, action: 'user.changePassword', entityType: 'User', entityId: u.id, ip: actor.ip }),
  ]);
}

// ---------------------------------------------------------------- leaves (SPEC 6.1 OFF có ngày bắt đầu/kết thúc)

export async function addLeave(db: Db, actor: Actor, userId: string, input: { startAt: Date; endAt: Date; reason?: string | null }) {
  assertAuthorized(actor.user!, 'user.manage');
  if (input.endAt <= input.startAt) throw new ValidationError('Ngày kết thúc phải sau ngày bắt đầu');
  const u = await db.user.findFirst({ where: { id: userId, orgId: actor.orgId, deletedAt: null } });
  if (!u) throw new NotFoundError('Không tìm thấy người dùng');
  return db.$transaction(async (tx) => {
    const leave = await tx.userLeave.create({ data: { userId, startAt: input.startAt, endAt: input.endAt, reason: input.reason?.trim() || null } });
    await recordAudit(tx, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'user.leave.add', entityType: 'User', entityId: userId, after: { leaveId: leave.id, startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString() }, ip: actor.ip });
    return leave;
  });
}

export async function removeLeave(db: Db, actor: Actor, userId: string, leaveId: string) {
  assertAuthorized(actor.user!, 'user.manage');
  const leave = await db.userLeave.findFirst({ where: { id: leaveId, userId, user: { orgId: actor.orgId } } });
  if (!leave) throw new NotFoundError('Không tìm thấy lịch nghỉ');
  await db.$transaction([
    db.userLeave.delete({ where: { id: leaveId } }),
    recordAudit(db, { orgId: actor.orgId, actorId: actor.user!.id, via: actor.via, action: 'user.leave.remove', entityType: 'User', entityId: userId, before: { leaveId, startAt: leave.startAt.toISOString(), endAt: leave.endAt.toISOString() }, ip: actor.ip }),
  ]);
}

/** Assignable people for pickers (Owner/Manager "Giao cho…"). */
export async function assignableUsers(db: Db, orgId: string) {
  return db.user.findMany({
    where: { orgId, deletedAt: null, status: { not: 'INACTIVE' }, role: { in: ['SALES', 'OWNER', 'MANAGER'] } },
    orderBy: [{ role: 'desc' }, { fullName: 'asc' }],
    select: { id: true, fullName: true, role: true, status: true },
  });
}
