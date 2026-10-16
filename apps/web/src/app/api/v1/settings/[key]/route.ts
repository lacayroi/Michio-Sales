import { assertAuthorized } from '@michio/auth';
import { getSetting, recordAudit, setSetting } from '@michio/core';
import { SETTING_DEFAULTS, type SettingKey } from '@michio/shared';
import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';

function keyOf(raw: string): SettingKey {
  if (!(raw in SETTING_DEFAULTS)) throw new HttpError(404, 'NOT_FOUND', 'Không có cấu hình này');
  return raw as SettingKey;
}

/** Same JSON shape as the default: same primitive type, or same object keys / array. */
function sameShape(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return Array.isArray(b);
  if (a && typeof a === 'object') return !!b && typeof b === 'object' && !Array.isArray(b) && Object.keys(a).every((k) => k in (b as object));
  return typeof a === typeof b;
}

export const GET = route<{ key: string }>(async ({ ctx, user, params }) => {
  assertAuthorized(user, 'settings.manage');
  const key = keyOf(params.key);
  return { key, value: await getSetting(ctx.db, ctx.orgId, key) };
});

export const PUT = route<{ key: string }>(async ({ req, ctx, user, params }) => {
  assertAuthorized(user, 'settings.manage');
  const key = keyOf(params.key);
  const { value } = await readJson(req, z.object({ value: z.unknown() }));
  if (!sameShape(SETTING_DEFAULTS[key], value)) throw new HttpError(422, 'VALIDATION_ERROR', 'Giá trị không đúng định dạng');
  const before = await getSetting(ctx.db, ctx.orgId, key);
  await setSetting(ctx.db, ctx.orgId, key, value as never);
  await recordAudit(ctx.db, { orgId: ctx.orgId, actorId: user.id, via: 'WEB', action: 'setting.update', entityType: 'Setting', entityId: key, before: { value: before as never }, after: { value: value as never }, ip: ctx.ip });
  return { key, value };
});
