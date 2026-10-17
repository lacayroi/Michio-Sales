// Facebook webhook (SPEC 5.2, 11.1, 11.4): GET verify, POST verify X-Hub-Signature-256 on the raw body,
// store each event once (WebhookEvent), answer 200 fast (Meta wants ≤ 5 s); `channel-inbound` does the work.
import { FACEBOOK, verifyFacebookSignature } from '@michio/channels';
import { type ChannelInboundJob, INBOUND_JOB, ingestFacebookWebhook, QUEUES } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { apiError, handleError } from '@/lib/api';
import { queue } from '@/lib/services';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = process.env.FB_VERIFY_TOKEN;
  if (token && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === token) {
    return new NextResponse(q.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return apiError(403, 'INVALID_VERIFY_TOKEN', 'Verify token không khớp');
}

export async function POST(req: Request) {
  try {
    const secret = process.env.FB_APP_SECRET;
    if (!secret) return apiError(503, 'NOT_CONFIGURED', 'Facebook chưa được cấu hình');
    const raw = await req.text();
    if (!verifyFacebookSignature(raw, req.headers.get(FACEBOOK.signatureHeader), secret)) return apiError(403, 'INVALID_SIGNATURE', 'Sai chữ ký');
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return apiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ');
    }
    const { eventIds } = await ingestFacebookWebhook(prisma, payload);
    if (eventIds.length) {
      await queue(QUEUES.channelInbound).addBulk(
        eventIds.map((webhookEventId) => ({ name: 'event', data: { webhookEventId } satisfies ChannelInboundJob, opts: { ...INBOUND_JOB, jobId: `fb-${webhookEventId}` } })),
      );
    }
    return new NextResponse('EVENT_RECEIVED', { status: 200 });
  } catch (err) {
    return handleError(err);
  }
}
