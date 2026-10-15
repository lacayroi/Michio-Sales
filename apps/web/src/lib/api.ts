import 'server-only';
import { ForbiddenError } from '@michio/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { type CurrentUser, getCurrentUser } from './session';

// Error envelope (SPEC §8): { error: { code, message, details? } }
export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

export async function requireApiUser(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  return user ?? apiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập');
}

export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', z.flattenError(parsed.error));
  return parsed.data;
}

export function handleError(err: unknown) {
  if (err instanceof ForbiddenError) return apiError(403, err.code, err.message);
  console.error(err);
  return apiError(500, 'INTERNAL', 'Đã có lỗi xảy ra, vui lòng thử lại');
}

export function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
}
