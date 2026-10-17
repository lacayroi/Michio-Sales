import { createTask, TaskCreateInput } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const POST = route(async ({ req, ctx }) => createTask(ctx, await readJson(req, TaskCreateInput)), { status: 201 });
