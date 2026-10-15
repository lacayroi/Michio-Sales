import 'server-only';
import type { LoginAttemptStore } from '@michio/auth';
import { Redis } from 'ioredis';
import { env } from './env';

const g = globalThis as unknown as { redis?: Redis };

export function getRedis(): Redis {
  g.redis ??= new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  return g.redis;
}

export const redisLoginAttemptStore: LoginAttemptStore = {
  async get(key) {
    return Number((await getRedis().get(key)) ?? 0);
  },
  async increment(key, ttlSeconds) {
    const [[, count]] = (await getRedis().multi().incr(key).expire(key, ttlSeconds, 'NX').exec()) as [[unknown, number]];
    return count;
  },
  async reset(key) {
    await getRedis().del(key);
  },
};
