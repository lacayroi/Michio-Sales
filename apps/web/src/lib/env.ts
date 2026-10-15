import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const env = {
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  },
  get secureCookies() {
    return (process.env.APP_URL ?? '').startsWith('https://');
  },
};
