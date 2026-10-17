// WooCommerce product sync (SPEC 5.6). REST API wc/v3 with a Read-only Consumer Key/Secret.
// Platform facts (17/10/2026, docs/DECISIONS.md D-036): HTTP Basic auth over HTTPS; pagination via
// ?page (1-based) & ?per_page (WordPress REST max 100) with X-WP-Total / X-WP-TotalPages headers;
// `modified_after` (ISO 8601, WooCommerce ≥ 5.8) for incremental sync; webhooks signed with
// X-WC-Webhook-Signature = base64(HMAC-SHA256(raw body, webhook secret)).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const WOOCOMMERCE = {
  apiPath: '/wp-json/wc/v3',
  perPage: 100,
  signatureHeader: 'x-wc-webhook-signature',
  topicHeader: 'x-wc-webhook-topic',
  /** Incremental syncs re-read a short overlap so clock skew never loses an update. */
  overlapMinutes: 10,
} as const;

export interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

export interface WooProduct {
  id: number;
  name: string;
  sku: string;
  status: string; // publish | draft | private | pending
  permalink: string;
  regular_price: string;
  price: string;
  stock_status: string; // instock | outofstock | onbackorder
  date_modified_gmt: string | null;
  categories: { id: number; name: string }[];
  images: { src: string }[];
  attributes?: { name: string; options: string[] }[];
  brands?: { name: string }[];
}

/** Our Product fields from a Woo product. SKU-less products get `woo-{id}` and `needsSku` (SPEC 5.6). */
export function mapWooProduct(p: WooProduct) {
  const sku = p.sku?.trim();
  const brandAttr = p.attributes?.find((a) => /brand|thuong hieu|thương hiệu/i.test(a.name))?.options[0];
  const price = Number(p.regular_price || p.price);
  return {
    wooId: p.id,
    sku: sku || `woo-${p.id}`,
    needsSku: !sku,
    name: p.name.trim(),
    brand: p.brands?.[0]?.name ?? brandAttr ?? null,
    imageUrl: p.images[0]?.src ?? null,
    productUrl: p.permalink || null,
    retailPrice: Number.isFinite(price) && price > 0 ? Math.round(price) : null,
    inStock: p.stock_status !== 'outofstock',
    isActive: p.status === 'publish',
    wooCategoryIds: p.categories.map((c) => c.id),
    wooModifiedAt: p.date_modified_gmt ? new Date(`${p.date_modified_gmt.replace(/Z$/, '')}Z`) : null,
  };
}
export type MappedWooProduct = ReturnType<typeof mapWooProduct>;

export function signWooPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

export function verifyWooSignature(rawBody: string, header: string | null | undefined, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(signWooPayload(rawBody, secret));
  const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export class WooApiError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(`WooCommerce ${status ?? 'network'}: ${message}`);
    this.name = 'WooApiError';
  }
}

export interface WooPage<T> {
  items: T[];
  totalPages: number;
}

export interface WooClient {
  readonly mode: 'live' | 'mock';
  listProducts(opts: { page: number; modifiedAfter?: Date }): Promise<WooPage<WooProduct>>;
  listCategories(page: number): Promise<WooPage<WooCategory>>;
}

export interface WooConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export function createWooHttpClient(cfg: WooConfig, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): WooClient {
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64')}`;
  async function get<T>(path: string, query: Record<string, string>): Promise<WooPage<T>> {
    const url = new URL(`${cfg.baseUrl.replace(/\/$/, '')}${WOOCOMMERCE.apiPath}/${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    } catch (err) {
      throw new WooApiError(null, err instanceof Error ? err.message : String(err));
    }
    const body = (await res.json().catch(() => null)) as T[] | { message?: string } | null;
    if (!res.ok || !Array.isArray(body)) throw new WooApiError(res.status, (body as { message?: string } | null)?.message ?? res.statusText);
    return { items: body, totalPages: Number(res.headers.get('x-wp-totalpages') ?? 1) || 1 };
  }
  return {
    mode: 'live',
    listProducts: ({ page, modifiedAfter }) =>
      get<WooProduct>('products', {
        page: String(page),
        per_page: String(WOOCOMMERCE.perPage),
        orderby: 'id',
        order: 'asc',
        ...(modifiedAfter ? { modified_after: modifiedAfter.toISOString().replace(/\.\d{3}Z$/, ''), dates_are_gmt: 'true' } : {}),
      }),
    listCategories: (page) => get<WooCategory>('products/categories', { page: String(page), per_page: String(WOOCOMMERCE.perPage) }),
  };
}

// ---------- mock (MOCK_INTEGRATIONS=true) ----------

const MOCK_CATEGORIES: WooCategory[] = [
  { id: 101, name: 'Matcha & Trà Nhật', slug: 'matcha-tra-nhat', parent: 0 },
  { id: 102, name: 'Thực phẩm', slug: 'thuc-pham', parent: 0 },
  { id: 103, name: 'Bánh kẹo', slug: 'banh-keo', parent: 102 },
  { id: 104, name: 'Đồ uống', slug: 'do-uong', parent: 0 },
  { id: 105, name: 'Gia dụng', slug: 'gia-dung', parent: 0 },
];

const MOCK_NAMES: [string, number, number, string][] = [
  ['Bột matcha Uji Marukyu Koyamaen 100g', 101, 420000, 'WOO-MAT-01'],
  ['Trà xanh Itoen Oi Ocha túi lọc 50 gói', 101, 135000, 'WOO-MAT-02'],
  ['Bánh Kitkat matcha hộp 12 thanh', 103, 115000, 'WOO-BK-01'],
  ['Kẹo dẻo Kasugai vị nho 107g', 103, 45000, 'WOO-BK-02'],
  ['Nước tương Kikkoman 1L', 102, 98000, 'WOO-TP-01'],
  ['Trà sữa Royal Milk Tea Nittoh 10 gói', 104, 89000, ''],
  ['Nước rửa bát Kao Kyukyuto 240ml', 105, 52000, 'WOO-GD-01'],
  ['Viên tẩy lồng máy giặt Kao 3 viên', 105, 75000, 'WOO-GD-02'],
];

/** A small Woo-shaped catalog; `touch()` simulates an edit on the website for incremental syncs. */
export function createWooMockClient() {
  const base = Date.UTC(2026, 9, 1);
  const products: WooProduct[] = MOCK_NAMES.map(([name, cat, price, sku], i) => ({
    id: 5001 + i,
    name,
    sku,
    status: 'publish',
    permalink: `https://michiovietnam.com/san-pham/mock-${5001 + i}/`,
    regular_price: String(price),
    price: String(price),
    stock_status: i === 3 ? 'outofstock' : 'instock',
    date_modified_gmt: new Date(base + i * 3600_000).toISOString().slice(0, 19),
    categories: [{ id: cat, name: MOCK_CATEGORIES.find((c) => c.id === cat)!.name }],
    images: [],
  }));
  const client: WooClient & { products: WooProduct[]; touch(id: number, patch: Partial<WooProduct>, at?: Date): void } = {
    mode: 'mock',
    products,
    touch(id, patch, at = new Date()) {
      const p = products.find((x) => x.id === id);
      if (p) Object.assign(p, patch, { date_modified_gmt: at.toISOString().slice(0, 19) });
    },
    async listProducts({ page, modifiedAfter }) {
      const all = products.filter((p) => !modifiedAfter || new Date(`${p.date_modified_gmt}Z`) > modifiedAfter);
      const per = 5; // small pages so pagination is exercised
      return { items: all.slice((page - 1) * per, page * per), totalPages: Math.max(1, Math.ceil(all.length / per)) };
    },
    async listCategories(page) {
      return { items: page === 1 ? MOCK_CATEGORIES : [], totalPages: 1 };
    },
  };
  return client;
}
