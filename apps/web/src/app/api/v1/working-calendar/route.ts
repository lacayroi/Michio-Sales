import { assertAuthorized } from '@michio/auth';
import { getWorkingCalendar, setWorkingCalendar, WorkingCalendarInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

/** Giờ làm việc (SPEC A1, 6.12) — used for every SLA. */
export const GET = route(async ({ ctx, user }) => {
  assertAuthorized(user, 'settings.manage');
  return { weekly: await getWorkingCalendar(ctx) };
});

export const PUT = route(async ({ req, ctx }) => ({ weekly: await setWorkingCalendar(ctx, await readJson(req, WorkingCalendarInput)) }));
