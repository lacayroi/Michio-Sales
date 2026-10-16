// Website form → lead (SPEC 5.1, Phụ lục B). Authenticated by X-Api-Key, not by session.
import { apiActor, intakeLead, verifyApiKey } from '@michio/core';
import { type LeadSource, prisma } from '@michio/db';
import { foldVietnamese, maskPhone, parseBusinessModel, parseInterestCategories, parseOrderBand } from '@michio/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, clientIp, handleError } from '@/lib/api';
import { getEffects } from '@/lib/effects';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_PER_MINUTE = 60; // SPEC 11.1

const str = (max: number) => z.string().trim().max(max).nullish();

const Body = z.object({
  formType: z.enum(['WHOLESALE', 'AGENT']).default('WHOLESALE'),
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(8).max(30),
  shopName: str(200),
  email: z.union([z.email().max(200), z.literal('')]).nullish(),
  province: str(100),
  address: str(500),
  businessModel: str(100),
  expectedOrderBand: str(100),
  interestCategories: z.union([z.array(z.string().max(100)).max(30), z.string().max(1000)]).nullish(),
  note: str(5000),
  pageUrl: str(1000),
  utm: z.record(z.string(), z.string().max(200)).nullish(),
  website: z.string().nullish(), // honeypot — must be empty
});

async function rateLimited(keyId: string): Promise<boolean> {
  try {
    const bucket = `rl:public-leads:${keyId}:${Math.floor(Date.now() / 60_000)}`;
    const n = await getRedis().incr(bucket);
    if (n === 1) await getRedis().expire(bucket, 70);
    return n > RATE_LIMIT_PER_MINUTE;
  } catch {
    return false; // Redis down must not lose a customer's form
  }
}

export async function POST(req: Request) {
  try {
    const key = await verifyApiKey(prisma, req.headers.get('x-api-key'));
    if (!key) return apiError(401, 'INVALID_API_KEY', 'API key không hợp lệ');
    if (await rateLimited(key.id)) return apiError(429, 'RATE_LIMITED', 'Quá nhiều yêu cầu, vui lòng thử lại sau');

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ');
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return apiError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', z.flattenError(parsed.error));
    const b = parsed.data;

    // Bots fill hidden fields: answer like a success so they don't adapt, store nothing.
    if (b.website) return NextResponse.json({ leadId: null, code: null, duplicate: false, assignedTo: null }, { status: 201 });

    const categories = await prisma.productCategory.findMany({ where: { orgId: key.orgId }, select: { name: true, code: true, id: true } });
    const extra = Object.fromEntries(categories.map((c) => [foldVietnamese(c.name), c.code ?? c.id]));
    const source: LeadSource = b.formType === 'AGENT' ? 'WEBSITE_AGENT_FORM' : 'WEBSITE_WHOLESALE_FORM';
    // Unknown labels never reject a lead: the raw form is kept in formPayload for the sales.
    const result = await intakeLead(prisma, getEffects(), apiActor(key.orgId, clientIp(req)), {
      source,
      contactName: b.fullName,
      phone: b.phone,
      email: b.email || null,
      shopName: b.shopName,
      province: b.province,
      address: b.address,
      businessModel: parseBusinessModel(b.businessModel),
      expectedOrderBand: parseOrderBand(b.expectedOrderBand),
      interestCategories: parseInterestCategories(b.interestCategories, extra),
      need: b.note,
      utm: b.utm ?? null,
      campaign: b.utm?.campaign ?? null,
      formPayload: { ...b, website: undefined, apiKey: key.name },
    });
    console.info(JSON.stringify({ msg: 'public lead', leadId: result.leadId, phone: maskPhone(b.phone), duplicate: result.duplicate }));
    return NextResponse.json(
      { leadId: result.leadId, code: result.code, duplicate: result.duplicate, assignedTo: result.assignedTo?.fullName ?? null },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    return handleError(err);
  }
}
