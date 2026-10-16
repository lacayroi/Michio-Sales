import 'server-only';
import { z } from 'zod';
import { PageQuery, zArray, zBool } from './api';

export const LEAD_SOURCES = [
  'WEBSITE_WHOLESALE_FORM', 'WEBSITE_AGENT_FORM', 'FACEBOOK_MESSENGER', 'FACEBOOK_LEAD_ADS', 'ZALO_COMPANY',
  'ZALO_OA', 'HOTLINE', 'REFERRAL', 'IMPORT', 'MANUAL', 'OTHER',
] as const;
export const LEAD_STATUSES = ['NEW', 'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'WON', 'LOST'] as const;
export const PRIORITIES = ['HOT', 'WARM', 'COLD'] as const;
export const BUSINESS_MODELS = ['JAPAN_STORE', 'ONLINE_SHOP', 'MINIMART', 'RETAIL_AGENT', 'CAFE', 'DISTRIBUTOR', 'OTHER'] as const;
export const ORDER_BANDS = ['LT_5M', 'B5_10M', 'B10_30M', 'B30_50M', 'GT_50M', 'UNKNOWN'] as const;
export const LIFECYCLES = ['PROSPECT', 'NEW_CUSTOMER', 'REPEAT', 'AT_RISK', 'DORMANT'] as const;
export const ROLES = ['OWNER', 'MANAGER', 'SALES', 'SUPPORT', 'VIEWER'] as const;

const optStr = (max = 500) => z.string().trim().max(max).nullish();

export const CustomerFields = {
  phone: optStr(30),
  email: z.union([z.email().max(200), z.literal('')]).nullish(),
  shopName: optStr(200),
  taxCode: optStr(30),
  businessModel: z.enum(BUSINESS_MODELS).nullish(),
  expectedOrderBand: z.enum(ORDER_BANDS).nullish(),
  interestCategories: z.array(z.string().max(60)).max(30).optional(),
  province: optStr(100),
  address: optStr(500),
  facebookUrl: optStr(300),
  zaloPhone: optStr(30),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
};

export const LeadCreateBody = z.object({
  source: z.enum(LEAD_SOURCES),
  contactName: z.string().trim().min(1).max(200),
  ...CustomerFields,
  need: optStr(2000),
  campaign: optStr(200),
  priority: z.enum(PRIORITIES).nullish(),
  /** auto = luật chia; self = giữ cho mình (SALES); user = giao cho người cụ thể */
  assign: z.enum(['auto', 'self', 'user']).optional(),
  assigneeId: z.string().optional(),
});

/** §8 POST /leads/quick {phone, name, note, source} */
export const QuickLeadBody = z.object({
  phone: z.string().trim().min(8).max(30),
  name: z.string().trim().min(1).max(200),
  note: optStr(2000),
  source: z.enum(LEAD_SOURCES).default('ZALO_COMPANY'),
  assign: z.enum(['auto', 'self']).optional(),
});

export const LeadListQuery = z.object({
  status: zArray(z.enum(LEAD_STATUSES)).optional(),
  ownerId: z.string().optional(),
  source: zArray(z.enum(LEAD_SOURCES)).optional(),
  priority: zArray(z.enum(PRIORITIES)).optional(),
  businessModel: zArray(z.enum(BUSINESS_MODELS)).optional(),
  province: z.string().optional(),
  q: z.string().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  slaBreached: zBool.optional(),
  ...PageQuery,
});

export const CustomerListQuery = z.object({
  q: z.string().max(100).optional(),
  lifecycle: zArray(z.enum(LIFECYCLES)).optional(),
  ownerId: z.string().optional(),
  businessModel: zArray(z.enum(BUSINESS_MODELS)).optional(),
  province: z.string().optional(),
  tier: z.string().optional(),
  ...PageQuery,
});

export const CustomerPatchBody = z.object({
  contactName: z.string().trim().min(1).max(200).optional(),
  ...CustomerFields,
  tier: optStr(30),
  priceListId: z.string().nullish(),
  note: optStr(5000),
  reorderCycleDays: z.number().int().min(7).max(120).optional(),
});

export function toLeadInput(b: z.infer<typeof LeadCreateBody>) {
  return {
    source: b.source,
    contactName: b.contactName,
    phone: b.phone,
    email: b.email || null,
    shopName: b.shopName,
    taxCode: b.taxCode,
    businessModel: b.businessModel,
    expectedOrderBand: b.expectedOrderBand,
    interestCategories: b.interestCategories,
    province: b.province,
    address: b.address,
    facebookUrl: b.facebookUrl,
    zaloPhone: b.zaloPhone,
    tags: b.tags,
    need: b.need,
    campaign: b.campaign,
    priority: b.priority,
  };
}
