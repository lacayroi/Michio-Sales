import { findApiKey, intakeLead } from '@michio/core';
import { prisma } from '@michio/db';
import { isHoneypotTriggered, PublicLeadPayload, toLeadIntake } from '@michio/integrations';
import { NextResponse } from 'next/server';
import { apiError, clientIp, handleError } from '@/lib/api';
import { getRedis } from '@/lib/redis';
import { serviceContext } from '@/lib/services';

const RATE_LIMIT_PER_MINUTE = 60; // SPEC 11.1

/** Website forms (SPEC 5.1, Phụ lục B). Auth: X-Api-Key. */
export async function POST(req: Request) {
  try {
    const key = await findApiKey(prisma, req.headers.get('x-api-key') ?? '');
    if (!key) return apiError(401, 'INVALID_API_KEY', 'API key không hợp lệ');

    const bucket = `rl:public-leads:${key.id}:${Math.floor(Date.now() / 60_000)}`;
    const redis = getRedis();
    const [[, hits]] = (await redis.multi().incr(bucket).expire(bucket, 120).exec()) as [[unknown, number], unknown];
    if (hits > RATE_LIMIT_PER_MINUTE) return apiError(429, 'RATE_LIMITED', 'Gửi quá nhiều, thử lại sau 1 phút');

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ');
    }
    const payload = PublicLeadPayload.parse(body);
    // Bots fill the hidden field: accept silently so they learn nothing, but create nothing.
    if (isHoneypotTriggered(payload)) return NextResponse.json({ ok: true }, { status: 202 });

    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    const ctx = serviceContext(null, { orgId: key.orgId, ip: clientIp(req), via: 'API' });
    const r = await intakeLead(ctx, toLeadIntake(payload));
    return NextResponse.json({ leadId: r.leadId, code: r.code, duplicate: r.duplicate, assignedTo: r.assignedTo }, { status: r.duplicate ? 200 : 201 });
  } catch (err) {
    return handleError(err);
  }
}
