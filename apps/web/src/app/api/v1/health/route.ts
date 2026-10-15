import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

async function check<T>(fn: () => Promise<T>): Promise<{ ok: boolean; detail?: T | string }> {
  try {
    return { ok: true, detail: await fn() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const [db, redis, worker, channels] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`.then(() => undefined)),
    check(() => getRedis().ping()),
    check(async () => {
      const at = await getRedis().get('worker:heartbeat');
      if (!at) throw new Error('no heartbeat');
      return at;
    }),
    check(() =>
      prisma.channelAccount.findMany({ select: { type: true, name: true, status: true }, orderBy: { type: 'asc' } }),
    ),
  ]);
  const ok = db.ok && redis.ok;
  return NextResponse.json(
    { ok, db: { ok: db.ok }, redis: { ok: redis.ok }, worker, channels: channels.ok ? channels.detail : [] },
    { status: ok ? 200 : 503 },
  );
}
