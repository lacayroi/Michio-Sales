import { describe, expect, it, vi } from 'vitest';
import { createWooHttpClient, createWooMockClient, mapWooProduct, signWooPayload, verifyWooSignature, type WooProduct } from './woocommerce';

const P: WooProduct = {
  id: 77, name: ' Bột matcha 100g ', sku: '', status: 'publish', permalink: 'https://x/p/77', regular_price: '420000.00', price: '399000',
  stock_status: 'outofstock', date_modified_gmt: '2026-10-10T03:04:05', categories: [{ id: 9, name: 'Matcha' }], images: [{ src: 'https://x/a.jpg' }],
  attributes: [{ name: 'Thương hiệu', options: ['Marukyu'] }],
};

describe('mapWooProduct', () => {
  it('maps fields, SKU fallback and stock', () => {
    expect(mapWooProduct(P)).toEqual({
      wooId: 77, sku: 'woo-77', needsSku: true, name: 'Bột matcha 100g', brand: 'Marukyu', imageUrl: 'https://x/a.jpg', productUrl: 'https://x/p/77',
      retailPrice: 420000, inStock: false, isActive: true, wooCategoryIds: [9], wooModifiedAt: new Date('2026-10-10T03:04:05Z'),
    });
    expect(mapWooProduct({ ...P, sku: 'MC-1', status: 'draft', regular_price: '', price: '' })).toMatchObject({ sku: 'MC-1', needsSku: false, isActive: false, retailPrice: null });
  });
});

describe('webhook signature', () => {
  it('is base64 HMAC-SHA256 of the raw body', () => {
    const body = JSON.stringify({ id: 1, name: 'Trà xanh' });
    const sig = signWooPayload(body, 's3cret');
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(verifyWooSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyWooSignature(`${body} `, sig, 's3cret')).toBe(false);
    expect(verifyWooSignature(body, sig, 'other')).toBe(false);
    expect(verifyWooSignature(body, null, 's3cret')).toBe(false);
  });
});

describe('HTTP client', () => {
  it('uses Basic auth, per_page=100, modified_after and X-WP-TotalPages', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify([P]), { status: 200, headers: { 'X-WP-TotalPages': '3' } }));
    const c = createWooHttpClient({ baseUrl: 'https://michiovietnam.com/', consumerKey: 'ck', consumerSecret: 'cs' }, { fetch: fetch as unknown as typeof globalThis.fetch });
    const r = await c.listProducts({ page: 2, modifiedAfter: new Date('2026-10-01T00:00:00.000Z') });
    expect(r).toEqual({ items: [P], totalPages: 3 });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/wp-json/wc/v3/products');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ page: '2', per_page: '100', modified_after: '2026-10-01T00:00:00', dates_are_gmt: 'true' });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('ck:cs').toString('base64')}`);
  });
  it('throws on errors', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 'woocommerce_rest_cannot_view', message: 'Sorry' }), { status: 401 }));
    const c = createWooHttpClient({ baseUrl: 'https://x', consumerKey: 'a', consumerSecret: 'b' }, { fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(c.listCategories(1)).rejects.toThrow('WooCommerce 401: Sorry');
  });
});

describe('mock client', () => {
  it('paginates and filters by modification time', async () => {
    const m = createWooMockClient();
    const p1 = await m.listProducts({ page: 1 });
    expect(p1.totalPages).toBe(2);
    m.touch(5002, { name: 'Đổi tên' }, new Date('2026-10-15T00:00:00Z'));
    const changed = await m.listProducts({ page: 1, modifiedAfter: new Date('2026-10-14T00:00:00Z') });
    expect(changed.items.map((p) => p.id)).toEqual([5002]);
  });
});
