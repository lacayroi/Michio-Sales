import { TaskUpdateInput, updateTask } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) => updateTask(ctx, params.id, await readJson(req, TaskUpdateInput)));
