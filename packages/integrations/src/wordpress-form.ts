// Maps the website form payload (SPEC Phụ lục B) to lead intake fields.
// Accepts both Vietnamese labels (as typed in the WordPress form options) and system codes (SPEC 5.1).
import { z } from 'zod';

/** Lowercase, strip Vietnamese diacritics and punctuation noise: "Shop Online" → "shop online". */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const BUSINESS_MODEL_ALIASES: Record<string, string[]> = {
  JAPAN_STORE: ['cua hang hang nhat', 'cua hang nhat', 'shop hang nhat'],
  ONLINE_SHOP: ['shop online', 'ban online', 'online'],
  MINIMART: ['minimart', 'sieu thi mini', 'minimart / sieu thi mini'],
  RETAIL_AGENT: ['dai ly ban le', 'dai ly'],
  CAFE: ['quan cafe', 'cafe', 'quan cafe / do uong', 'do uong', 'quan ca phe'],
  DISTRIBUTOR: ['doanh nghiep', 'doi tac phan phoi', 'doanh nghiep / doi tac phan phoi', 'nha phan phoi'],
  OTHER: ['khac'],
};

/** With `strict`, an unrecognised label returns null (import reports it) instead of OTHER (web form keeps the lead). */
export function mapBusinessModel(v: string | undefined | null, strict = false): string | undefined | null {
  if (!v) return undefined;
  const code = v.trim().toUpperCase();
  if (code in BUSINESS_MODEL_ALIASES) return code;
  const f = fold(v);
  for (const [k, aliases] of Object.entries(BUSINESS_MODEL_ALIASES)) if (aliases.some((a) => f === a)) return k;
  for (const [k, aliases] of Object.entries(BUSINESS_MODEL_ALIASES)) if (k !== 'OTHER' && aliases.some((a) => f.includes(a))) return k;
  return strict ? null : 'OTHER';
}

const BAND_CODES = ['LT_5M', 'B5_10M', 'B10_30M', 'B30_50M', 'GT_50M', 'UNKNOWN'];

/** "10–30 triệu", "10-30tr", "<5tr", "Trên 50 triệu", "5_10M", "B5_10M" → OrderBand */
export function mapOrderBand(v: string | undefined | null, strict = false): string | undefined | null {
  if (!v) return undefined;
  const raw = v.trim().toUpperCase();
  if (BAND_CODES.includes(raw)) return raw;
  if (/^\d+_\d+M$/.test(raw)) return BAND_CODES.includes(`B${raw}`) ? `B${raw}` : 'UNKNOWN'; // SPEC 5.1 writes 5_10M
  const f = fold(v);
  const nums = (f.match(/\d+/g) ?? []).map(Number);
  if (nums.length >= 2) {
    const key = `B${nums[0]}_${nums[1]}M`;
    if (BAND_CODES.includes(key)) return key;
  } else if (nums.length === 1) {
    if (nums[0] === 5 && /(<|duoi|nho hon)/.test(f)) return 'LT_5M';
    if (nums[0] === 50 && /(>|tren|lon hon)/.test(f)) return 'GT_50M';
  } else if (/(chua ro|khong ro|khong biet)/.test(f)) {
    return 'UNKNOWN';
  }
  return strict ? null : 'UNKNOWN';
}

const CATEGORY_ALIASES: Record<string, string[]> = {
  MATCHA_TEA: ['matcha', 'tra'],
  FOOD: ['thuc pham', 'banh keo', 'gia vi', 'do an'],
  DRINK: ['do uong', 'nuoc'],
  HOUSEHOLD: ['gia dung', 'tay rua', 'con trung', 'dung cu bep'],
};

export function mapCategory(v: string, strict = false): string | null {
  const code = v.trim().toUpperCase();
  if (code in CATEGORY_ALIASES || code === 'OTHER') return code;
  const f = fold(v);
  if (f === 'khac') return 'OTHER';
  for (const [k, aliases] of Object.entries(CATEGORY_ALIASES)) if (aliases.some((a) => f.includes(a))) return k;
  return strict ? null : 'OTHER';
}

const listOf = z.preprocess((v) => {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean); // WPForms checkbox values arrive newline-separated
}, z.array(z.string().max(100)).max(30));

const str = (max: number) => z.preprocess((v) => (v == null ? undefined : String(v)), z.string().trim().max(max).optional());

/** Body of POST /api/v1/public/leads (SPEC Phụ lục B). */
export const PublicLeadPayload = z.object({
  formType: z.enum(['WHOLESALE', 'AGENT']).default('WHOLESALE'),
  fullName: z.string().trim().min(1, 'Thiếu họ tên').max(120),
  phone: z.string().trim().min(6, 'Thiếu số điện thoại').max(30),
  shopName: str(200),
  email: str(200),
  province: str(80),
  businessModel: str(100),
  expectedOrderBand: str(60),
  interestCategories: listOf,
  note: str(2000),
  pageUrl: str(500),
  utm: z.record(z.string(), z.preprocess((v) => String(v ?? ''), z.string().max(200))).optional(),
  website: z.string().optional(), // honeypot — must be empty
});
export type PublicLeadPayload = z.infer<typeof PublicLeadPayload>;

export function isHoneypotTriggered(p: Pick<PublicLeadPayload, 'website'>): boolean {
  return Boolean(p.website && p.website.trim() !== '');
}

/** Converts a validated payload into LeadIntakeInput fields (without assignment options). */
export function toLeadIntake(p: PublicLeadPayload) {
  const email = p.email && z.email().safeParse(p.email).success ? p.email : undefined;
  return {
    source: p.formType === 'AGENT' ? ('WEBSITE_AGENT_FORM' as const) : ('WEBSITE_WHOLESALE_FORM' as const),
    fullName: p.fullName,
    phone: p.phone,
    email,
    shopName: p.shopName,
    province: p.province,
    businessModel: mapBusinessModel(p.businessModel) as never,
    expectedOrderBand: mapOrderBand(p.expectedOrderBand) as never,
    interestCategories: [...new Set(p.interestCategories.map((c) => mapCategory(c) as string))],
    need: p.note,
    campaign: p.utm?.campaign,
    utm: p.utm,
    formPayload: { ...p, website: undefined },
  };
}
