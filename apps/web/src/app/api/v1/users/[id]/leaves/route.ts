import { addLeave, LeaveInput, listLeaves } from '@michio/core';
import { readJson, route } from '@/lib/api';

/** §8 CRUD /users/:id/leaves (SPEC 6.1: nghỉ phép có ngày bắt đầu/kết thúc). */
export const GET = route<{ id: string }>(async ({ ctx, params }) => ({ items: await listLeaves(ctx, params.id) }));

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => addLeave(ctx, params.id, await readJson(req, LeaveInput)), { status: 201 });
