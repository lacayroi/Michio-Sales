import 'server-only';
import { createRedisEffects, type ServiceContext } from '@michio/core';
import { prisma } from '@michio/db';
import { Queue } from 'bullmq';
import { getRedis } from './redis';
import type { CurrentUser } from './session';

const g = globalThis as unknown as { effects?: ReturnType<typeof createRedisEffects>; queues?: Map<string, Queue> };

export function effects() {
  g.effects ??= createRedisEffects(getRedis());
  return g.effects;
}

export function queue(name: string): Queue {
  g.queues ??= new Map();
  let q = g.queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedis() });
    g.queues.set(name, q);
  }
  return q;
}

export function serviceContext(user: CurrentUser | null, opts: { orgId?: string; ip?: string | null; via?: ServiceContext['via'] } = {}): ServiceContext {
  const orgId = user?.orgId ?? opts.orgId;
  if (!orgId) throw new Error('orgId required');
  return { db: prisma, effects: effects(), now: () => new Date(), actor: user, orgId, via: opts.via ?? (user ? 'WEB' : 'API'), ip: opts.ip ?? null };
}
