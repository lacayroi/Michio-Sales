import 'server-only';
import { ForbiddenError } from '@michio/auth';
import { type Actor, DomainError, userActor } from '@michio/core';
import { Prisma } from '@michio/db';
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

/** Validate URL search params (repeated keys become arrays). */
export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> | NextResponse {
  const params = new URL(req.url).searchParams;
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key).flatMap((v) => v.split(',')).filter((v) => v !== '');
    if (all.length) obj[key] = all.length > 1 ? all : all[0]!;
  }
  const parsed = schema.safeParse(obj);
  if (!parsed.success) return apiError(422, 'VALIDATION_ERROR', 'Tham số không hợp lệ', z.flattenError(parsed.error));
  return parsed.data;
}

export function handleError(err: unknown) {
  if (err instanceof ForbiddenError) return apiError(403, err.code, err.message);
  if (err instanceof DomainError) return apiError(err.status, err.code, err.message, err.details);
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return apiError(404, 'NOT_FOUND', 'Không tìm thấy dữ liệu');
  console.error(err);
  return apiError(500, 'INTERNAL', 'Đã có lỗi xảy ra, vui lòng thử lại');
}

export function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
}

export const actorOf = (user: CurrentUser, req: Request): Actor => userActor(user, 'WEB', clientIp(req));

type Params = Record<string, string>;
type Handler<P extends Params> = (req: Request, ctx: { user: CurrentUser; actor: Actor; params: P }) => Promise<Response>;

/** Session-authenticated route: 401 without a session, domain errors mapped to the §8 envelope. */
export function authed<P extends Params = Params>(fn: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const user = await requireApiUser();
      if (user instanceof NextResponse) return user;
      return await fn(req, { user, actor: actorOf(user, req), params: await ctx.params });
    } catch (err) {
      return handleError(err);
    }
  };
}

export const zArray = <T extends z.ZodType>(item: T) => z.union([item, z.array(item)]).transform((v) => (Array.isArray(v) ? v : [v]) as z.infer<T>[]);
export const zBool = z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true');
export const PageQuery = { cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() };
