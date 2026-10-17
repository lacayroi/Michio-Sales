// Thông tin công ty in trên PDF báo giá (SPEC 6.12).
import { assertAuthorized } from '@michio/auth';
import { CompanyProfileInput, getCompanyProfile, updateCompanyProfile } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route(async ({ ctx, user }) => {
  assertAuthorized(user, 'settings.manage');
  return getCompanyProfile(ctx.db, ctx.orgId);
});
export const PUT = route(async ({ req, ctx }) => updateCompanyProfile(ctx, await readJson(req, CompanyProfileInput)));
