import { z } from 'zod';

const LEAD_SOURCES = [
  'WEBSITE_WHOLESALE_FORM', 'WEBSITE_AGENT_FORM', 'FACEBOOK_MESSENGER', 'FACEBOOK_LEAD_ADS', 'ZALO_COMPANY',
  'ZALO_OA', 'HOTLINE', 'REFERRAL', 'IMPORT', 'MANUAL', 'OTHER',
] as const;
const BUSINESS_MODELS = ['JAPAN_STORE', 'ONLINE_SHOP', 'MINIMART', 'RETAIL_AGENT', 'CAFE', 'DISTRIBUTOR', 'OTHER'] as const;
const ORDER_BANDS = ['LT_5M', 'B5_10M', 'B10_30M', 'B30_50M', 'GT_50M', 'UNKNOWN'] as const;

/** AssignmentRule.conditions (SPEC 6.3.2). Every present list must match; empty object = match all. */
export const RuleConditions = z
  .object({
    sources: z.array(z.enum(LEAD_SOURCES)).optional(),
    businessModels: z.array(z.enum(BUSINESS_MODELS)).optional(),
    orderBands: z.array(z.enum(ORDER_BANDS)).optional(),
    interestCategories: z.array(z.string()).optional(), // any overlap
    provinces: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(), // any overlap
    timeWindow: z.enum(['BUSINESS_HOURS', 'OUT_OF_HOURS']).optional(),
  })
  .strict();
export type RuleConditions = z.infer<typeof RuleConditions>;

export interface LeadFacts {
  source: string;
  businessModel?: string | null;
  orderBand?: string | null;
  interestCategories?: string[];
  province?: string | null;
  tags?: string[];
  inBusinessHours: boolean;
}

const has = (list: string[] | undefined, v: string | null | undefined) => !list?.length || (v != null && list.includes(v));
const overlaps = (list: string[] | undefined, vs: string[] | undefined) => !list?.length || (vs ?? []).some((v) => list.includes(v));
const norm = (s: string) => s.normalize('NFC').trim().toLowerCase();

export function ruleMatches(raw: unknown, facts: LeadFacts): boolean {
  const parsed = RuleConditions.safeParse(raw ?? {});
  if (!parsed.success) return false; // invalid rule never matches
  const c = parsed.data;
  if (!has(c.sources, facts.source)) return false;
  if (!has(c.businessModels, facts.businessModel)) return false;
  if (!has(c.orderBands, facts.orderBand)) return false;
  if (!overlaps(c.interestCategories, facts.interestCategories)) return false;
  if (c.provinces?.length && !(facts.province && c.provinces.map(norm).includes(norm(facts.province)))) return false;
  if (!overlaps(c.tags, facts.tags)) return false;
  if (c.timeWindow === 'BUSINESS_HOURS' && !facts.inBusinessHours) return false;
  if (c.timeWindow === 'OUT_OF_HOURS' && facts.inBusinessHours) return false;
  return true;
}
