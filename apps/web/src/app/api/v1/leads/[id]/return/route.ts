import { returnLead } from '@michio/core';
import { z } from 'zod';
import { readJson, route } from '@/lib/api';

const Body = z.object({ reason: z.string().trim().max(500).optional() });

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => returnLead(ctx, params.id, (await readJson(req, Body)).reason));
