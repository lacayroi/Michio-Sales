import { authenticate, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@michio/auth';
import { recordAudit } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, clientIp, handleError, parseJson } from '@/lib/api';
import { env } from '@/lib/env';
import { redisLoginAttemptStore } from '@/lib/redis';

const Body = z.object({
  identifier: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

const MESSAGES = {
  INVALID_CREDENTIALS: 'Email/SĐT hoặc mật khẩu không đúng',
  LOCKED: 'Tài khoản tạm khóa 15 phút do nhập sai nhiều lần',
  INACTIVE: 'Tài khoản đã bị khóa, vui lòng liên hệ quản trị',
} as const;

export async function POST(req: Request) {
  try {
    const body = await parseJson(req, Body);
    if (body instanceof NextResponse) return body;

    const result = await authenticate(prisma, redisLoginAttemptStore, body);
    if (!result.ok) return apiError(result.code === 'LOCKED' ? 429 : 401, result.code, MESSAGES[result.code]);

    const { user } = result;
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      recordAudit(prisma, {
        orgId: user.orgId,
        actorId: user.id,
        via: 'WEB',
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        ip: clientIp(req),
      }),
    ]);

    const token = await createSessionToken({ userId: user.id, orgId: user.orgId, role: user.role }, env.sessionSecret);
    const res = NextResponse.json({ user: { id: user.id, fullName: user.fullName, role: user.role }, mustChangePassword: user.mustChangePassword });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
