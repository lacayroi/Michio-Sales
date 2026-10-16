import { resetUserPassword } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';

/** SPEC 6.1: Owner/Manager → mật khẩu tạm, bắt đổi ở lần đăng nhập sau. */
export const POST = authed<{ id: string }>(async (_req, { actor, params }) => NextResponse.json(await resetUserPassword(prisma, actor, params.id)));
