import 'server-only';
import { ForbiddenError } from '@michio/auth';
import { DomainError, type ServiceContext } from '@michio/core';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { serviceContext } from './services';
import { type CurrentUser, getCurrentUser } from './session';

// Error envelope (SPEC §8): { error: { code, message, details? } }
export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function requireApiUser(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  return user ?? apiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập');
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ');
  }
  return schema.parse(body);
}

/** For routes not using `route` (e.g. login): returns a 4xx response instead of throwing. */
export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | NextResponse> {
  try {
    return await readJson(req, schema);
  } catch (err) {
    return handleError(err);
  }
}

const DOMAIN_STATUS: Record<DomainError['code'], number> = { NOT_FOUND: 404, CONFLICT: 409, VALIDATION_ERROR: 422, INVALID_STATE: 409 };

export function handleError(err: unknown) {
  if (err instanceof HttpError) return apiError(err.status, err.code, err.message, err.details);
  if (err instanceof ForbiddenError) return apiError(403, err.code, err.message);
  if (err instanceof DomainError) return apiError(DOMAIN_STATUS[err.code], err.code, err.message, err.details);
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    return apiError(422, 'VALIDATION_ERROR', first?.message && first.message.length < 120 ? first.message : 'Dữ liệu không hợp lệ', z.flattenError(err));
  }
  console.error(err);
  return apiError(500, 'INTERNAL', 'Đã có lỗi xảy ra, vui lòng thử lại');
}

export function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
}

interface RouteArgs<P> {
  req: Request;
  user: CurrentUser;
  params: P;
  ctx: ServiceContext;
}

/** Authenticated route: session → handler → JSON (or a Response the handler builds itself). */
export function route<P = Record<string, string>>(handler: (a: RouteArgs<P>) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: Request, segment: { params: Promise<P> }) => {
    try {
      const user = await getCurrentUser();
      if (!user) return apiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập');
      if (user.mustChangePassword && !new URL(req.url).pathname.startsWith('/api/v1/me')) {
        return apiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Vui lòng đổi mật khẩu tạm trước khi tiếp tục');
      }
      const params = (await segment?.params) ?? ({} as P);
      const out = await handler({ req, user, params, ctx: serviceContext(user, { ip: clientIp(req) }) });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { status: opts.status ?? 200 });
    } catch (err) {
      return handleError(err);
    }
  };
}

export const searchParamsOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
