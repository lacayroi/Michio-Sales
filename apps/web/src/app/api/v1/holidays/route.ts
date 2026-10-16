import { assertAuthorized } from '@michio/auth';
import { addHoliday, HolidayInput } from '@michio/core';
import { z } from 'zod';
import { readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx, user }) => {
  assertAuthorized(user, 'settings.manage');
  const year = z.coerce.number().int().min(2020).max(2100).catch(new Date().getFullYear()).parse(searchParamsOf(req).year);
  const items = await ctx.db.holiday.findMany({
    where: { orgId: ctx.orgId, date: { gte: new Date(`${year}-01-01T00:00:00Z`), lt: new Date(`${year + 1}-01-01T00:00:00Z`) } },
    orderBy: { date: 'asc' },
  });
  return { year, items: items.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name })) };
});
export const POST = route(async ({ req, ctx }) => addHoliday(ctx, await readJson(req, HolidayInput)), { status: 201 });
