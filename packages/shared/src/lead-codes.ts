// Maps Vietnamese form/Excel labels to stored codes (SPEC 5.1, Phụ lục A/B).
// Accepts codes, labels with or without diacritics, and common shorthand ("10-30tr").
import { BUSINESS_MODEL_LABELS, ORDER_BAND_LABELS } from './labels';

export type BusinessModelCode = keyof typeof BUSINESS_MODEL_LABELS;
export type OrderBandCode = keyof typeof ORDER_BAND_LABELS;
export type PriorityCode = 'HOT' | 'WARM' | 'COLD';

/** Lowercase, strip Vietnamese diacritics, collapse everything else to single spaces. */
export function foldVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9<>]+/g, ' ')
    .trim();
}

const BUSINESS_MODEL_ALIASES: Record<string, BusinessModelCode> = {
  'cua hang hang nhat': 'JAPAN_STORE',
  'cua hang': 'JAPAN_STORE',
  'shop online': 'ONLINE_SHOP',
  'ban online': 'ONLINE_SHOP',
  'minimart sieu thi mini': 'MINIMART',
  minimart: 'MINIMART',
  'sieu thi mini': 'MINIMART',
  'sieu thi': 'MINIMART',
  'dai ly ban le': 'RETAIL_AGENT',
  'dai ly': 'RETAIL_AGENT',
  'quan cafe do uong': 'CAFE',
  'quan cafe': 'CAFE',
  cafe: 'CAFE',
  'doanh nghiep doi tac phan phoi': 'DISTRIBUTOR',
  'doanh nghiep': 'DISTRIBUTOR',
  'doi tac phan phoi': 'DISTRIBUTOR',
  'nha phan phoi': 'DISTRIBUTOR',
  khac: 'OTHER',
};

export function parseBusinessModel(input: string | null | undefined): BusinessModelCode | null {
  if (!input?.trim()) return null;
  const raw = input.trim().toUpperCase();
  if (raw in BUSINESS_MODEL_LABELS) return raw as BusinessModelCode;
  const f = foldVietnamese(input);
  return BUSINESS_MODEL_ALIASES[f] ?? null;
}

const BAND_BY_RANGE: Record<string, OrderBandCode> = {
  '5-10': 'B5_10M',
  '10-30': 'B10_30M',
  '30-50': 'B30_50M',
};

export function parseOrderBand(input: string | null | undefined): OrderBandCode | null {
  if (!input?.trim()) return null;
  const raw = input.trim().toUpperCase();
  if (raw in ORDER_BAND_LABELS) return raw as OrderBandCode;
  // SPEC 5.1 writes the middle bands without the "B" prefix (5_10M, 10_30M, 30_50M).
  if (/^\d+_\d+M$/.test(raw) && `B${raw}` in ORDER_BAND_LABELS) return `B${raw}` as OrderBandCode;

  const f = foldVietnamese(input);
  if (/chua ro|khong ro|chua biet|unknown/.test(f)) return 'UNKNOWN';
  const nums = (f.match(/\d+/g) ?? []).map(Number);
  if (nums.length >= 2) return BAND_BY_RANGE[`${nums[0]}-${nums[1]}`] ?? null;
  if (nums.length === 1) {
    if (nums[0] === 5 && /<|duoi|it hon/.test(f)) return 'LT_5M';
    if (nums[0] === 50 && />|tren|hon|lon hon/.test(f)) return 'GT_50M';
  }
  return null;
}

/** Form category codes (SPEC 5.1) and the labels the website uses. */
const CATEGORY_ALIASES: Record<string, string> = {
  'matcha tra': 'MATCHA_TEA',
  'matcha tra nhat': 'MATCHA_TEA',
  matcha: 'MATCHA_TEA',
  tra: 'MATCHA_TEA',
  'thuc pham': 'FOOD',
  'banh keo': 'CANDY',
  'gia vi': 'SPICE',
  'do uong': 'DRINK',
  'gia dung': 'HOUSEHOLD',
  'cham soc rang mieng': 'ORAL_CARE',
  'cham soc ca nhan': 'PERSONAL_CARE',
  'me be': 'MOM_BABY',
  'suc khoe': 'HEALTH',
  'sac dep': 'BEAUTY',
  khac: 'OTHER',
};

/**
 * Category labels/codes → codes. `extra` adds catalogue categories (synced from WooCommerce),
 * keyed by folded name. Unknown values map to OTHER so a lead is never rejected for it.
 */
export function parseInterestCategories(
  input: string | readonly string[] | null | undefined,
  extra: Readonly<Record<string, string>> = {},
): string[] {
  if (!input) return [];
  const items = typeof input === 'string' ? input.split(/[,;\n]/) : input;
  const out = new Set<string>();
  for (const item of items) {
    const v = item.trim();
    if (!v) continue;
    if (/^[A-Z][A-Z_]+$/.test(v)) {
      out.add(v);
      continue;
    }
    const f = foldVietnamese(v);
    out.add(CATEGORY_ALIASES[f] ?? extra[f] ?? 'OTHER');
  }
  return [...out];
}

export const DEFAULT_PRIORITY_BY_BAND: Record<OrderBandCode, PriorityCode> = {
  GT_50M: 'HOT',
  B30_50M: 'HOT',
  B10_30M: 'WARM',
  B5_10M: 'WARM',
  LT_5M: 'COLD',
  UNKNOWN: 'COLD',
};

/** Lead priority from expected order band (SPEC 5.1, setting `priority.byOrderBand`). */
export function priorityForBand(
  band: OrderBandCode | null | undefined,
  table: Partial<Record<OrderBandCode, PriorityCode>> = DEFAULT_PRIORITY_BY_BAND,
): PriorityCode {
  return table[band ?? 'UNKNOWN'] ?? DEFAULT_PRIORITY_BY_BAND[band ?? 'UNKNOWN'];
}
