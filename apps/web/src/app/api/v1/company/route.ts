import { assertAuthorized } from '@michio/auth';
import { getCompanyProfile, updateCompanyProfile } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, parseJson } from '@/lib/api';

/** Company profile used on quote PDFs (SPEC 6.12 "thông tin công ty"). */
export const GET = authed(async (_req, { user }) => {
  assertAuthorized(user, 'settings.manage');
  return NextResponse.json(await getCompanyProfile(prisma, user.orgId));
});

const s = z.string().trim().max(300).nullish();
const Body = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  profile: z.object({ legalName: s, address: s, hotline: s, zaloPhone: s, website: s, facebookPage: s, taxCode: s }),
});

export const PUT = authed(async (req, { actor }) => {
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;
  const profile = Object.fromEntries(Object.entries(body.profile).map(([k, v]) => [k, v ?? undefined]));
  await updateCompanyProfile(prisma, actor, { name: body.name, profile });
  return NextResponse.json({ ok: true });
});
