// WooCommerce webhook product.created/updated (SPEC 5.6, 11.1): verify X-WC-Webhook-Signature on the
// raw body, then queue an incremental sync (deduplicated per minute) instead of trusting the payload.
import { verifyWooSignature, WOOCOMMERCE } from '@michio/integrations';
import { QUEUES, type WooSyncJob } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { apiError, handleError } from '@/lib/api';
import { queue } from '@/lib/services';

export async function POST(req: Request) {
  try {
    const secret = process.env.WOO_WEBHOOK_SECRET;
    if (!secret) return apiError(503, 'NOT_CONFIGURED', 'Chưa cấu hình WOO_WEBHOOK_SECRET');
    const raw = await req.text();
    // WooCommerce pings the URL once when the webhook is created (body "webhook_id=…", no signature).
    if (!req.headers.get(WOOCOMMERCE.signatureHeader) && raw.startsWith('webhook_id=')) return NextResponse.json({ ok: true });
    if (!verifyWooSignature(raw, req.headers.get(WOOCOMMERCE.signatureHeader), secret)) return apiError(403, 'INVALID_SIGNATURE', 'Sai chữ ký');
    const topic = req.headers.get(WOOCOMMERCE.topicHeader) ?? '';
    if (topic.startsWith('product.')) {
      const account = await prisma.channelAccount.findFirst({ where: { type: 'WOOCOMMERCE' }, select: { orgId: true } });
      const org = account ?? (await prisma.organization.findFirst({ select: { id: true } }).then((o) => (o ? { orgId: o.id } : null)));
      if (org) {
        await queue(QUEUES.wooSync).add('sync', { orgId: org.orgId } satisfies WooSyncJob, { jobId: `woo-hook-${org.orgId}-${Math.floor(Date.now() / 60_000)}`, removeOnComplete: 100, removeOnFail: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
