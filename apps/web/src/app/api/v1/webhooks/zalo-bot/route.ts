// Zalo Bot webhook (SPEC 5.5, 11.1, 11.4): verify X-Bot-Api-Secret-Token, store the event, answer 200
// fast; the `zalo-bot-inbound` queue runs the command and replies.
import { verifyZaloBotSecret, ZALO_BOT } from '@michio/channels';
import { ingestZaloBotPayload, QUEUES, type ZaloBotInboundJob } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { apiError, handleError } from '@/lib/api';
import { queue } from '@/lib/services';

export async function POST(req: Request) {
  try {
    const secret = process.env.ZALO_BOT_WEBHOOK_SECRET;
    if (!secret) return apiError(503, 'NOT_CONFIGURED', 'Zalo Bot chưa được cấu hình');
    if (!verifyZaloBotSecret(req.headers.get(ZALO_BOT.secretHeader), secret)) return apiError(403, 'INVALID_SIGNATURE', 'Sai secret token');

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return apiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ');
    }
    const stored = await ingestZaloBotPayload(prisma, payload);
    if (stored && !stored.duplicate) {
      await queue(QUEUES.zaloBotInbound).add('message', { webhookEventId: stored.eventId } satisfies ZaloBotInboundJob, {
        jobId: `zb-${stored.eventId}`,
        removeOnComplete: 5000,
        removeOnFail: 5000,
      });
    }
    return NextResponse.json({ message: 'Success' });
  } catch (err) {
    return handleError(err);
  }
}
