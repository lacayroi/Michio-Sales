import { confirmHolidayYear } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

export const POST = route(async ({ req, ctx }) => {
  await confirmHolidayYear(ctx, (await readJson(req, z.object({ year: z.number().int().min(2020).max(2100) }))).year);
  return { ok: true };
});
