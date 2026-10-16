import 'server-only';
import { createRuntimeEffects, type RuntimeEffects } from '@michio/core/runtime';
import { Redis } from 'ioredis';
import { env } from './env';

const g = globalThis as unknown as { effects?: RuntimeEffects; bullRedis?: Redis };

/** Post-commit side effects (SSE publish, delayed SLA jobs). BullMQ needs maxRetriesPerRequest: null. */
export function getEffects(): RuntimeEffects {
  g.bullRedis ??= new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  g.effects ??= createRuntimeEffects(g.bullRedis);
  return g.effects;
}
