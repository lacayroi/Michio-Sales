// Server-Sent Events (SPEC 4.1, §8): Redis pub/sub → the user's browser.
import type { DomainEvent } from '@michio/core';
import { EVENTS_CHANNEL } from '@michio/core/runtime';
import { Redis } from 'ioredis';
import { requireApiUser } from '@/lib/api';
import { env } from '@/lib/env';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;

  const encoder = new TextEncoder();
  const sub = new Redis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const close = () => {
    clearInterval(heartbeat);
    sub.disconnect();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      sub.on('message', (_channel, message) => {
        let event: DomainEvent;
        try {
          event = JSON.parse(message) as DomainEvent;
        } catch {
          return;
        }
        if (event.orgId !== user.orgId) return;
        const forMe = event.userIds?.includes(user.id) || event.roles?.includes(user.role);
        if (!forMe) return;
        send(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      });
      await sub.connect();
      await sub.subscribe(EVENTS_CHANNEL);
      send('retry: 5000\n: connected\n\n');
      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      req.signal.addEventListener('abort', () => {
        close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel: close,
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
