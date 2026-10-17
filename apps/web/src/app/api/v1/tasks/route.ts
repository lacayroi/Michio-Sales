import { createTask, listTasks, TaskCreateInput } from '@michio/core';
import { readJson, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => listTasks(ctx, searchParamsOf(req)));
export const POST = route(async ({ req, ctx }) => createTask(ctx, await readJson(req, TaskCreateInput)), { status: 201 });
