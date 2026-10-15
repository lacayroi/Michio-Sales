import { type AppEvent, eventChannel, isInAudience } from '@michio/core';
import { apiError } from '@/lib/api';
import { getRedis } from '@/lib/redis';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000;

/** Server-Sent Events (SPEC §8): one Redis subscriber per open tab, filtered to the user's audience. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập');

  const sub = getRedis().duplicate();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* stream already closed */
        }
      };
      const close = () => {
        clearInterval(heartbeat);
        sub.disconnect();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', close);

      sub.on('message', (_channel, raw) => {
        let event: AppEvent;
        try {
          event = JSON.parse(raw);
        } catch {
          return;
        }
        if (isInAudience(event, user)) send(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      });
      await sub.subscribe(eventChannel(user.orgId));
      send('retry: 5000\n\n');
      send(`event: ready\ndata: {}\n\n`);
      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
    },
    cancel() {
      clearInterval(heartbeat);
      sub.disconnect();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
