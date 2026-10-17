// Product catalog (SPEC 6.6): synced from WooCommerce (M4), searched when quoting or sending in chat.
import { assertAuthorized } from '@michio/auth';
import type { Prisma } from '@michio/db';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { DomainError } from './errors';

export const ProductSearch = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().optional(),
  inStock: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional()),
  /** Quote builder / chat hide products marked "ẩn khi báo giá". */
  forQuote: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  includeInactive: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function searchProducts(ctx: ServiceContext, raw: z.input<typeof ProductSearch>) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  assertAuthorized(ctx.actor, 'product.view');
  const f = ProductSearch.parse(raw);
  const where: Prisma.ProductWhereInput = { orgId: ctx.orgId };
  if (!f.includeInactive) where.isActive = true;
  if (f.forQuote) where.showInQuote = true;
  if (f.inStock !== undefined) where.inStock = f.inStock;
  if (f.categoryId) where.categoryIds = { has: f.categoryId };
  if (f.q) {
    // Accent-insensitive match on name / SKU (SPEC 11.3: unaccent + pg_trgm index).
    const ids = await ctx.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Product"
      WHERE "orgId" = ${ctx.orgId}
        AND (f_unaccent(name) ILIKE '%' || f_unaccent(${f.q}) || '%' OR sku ILIKE '%' || ${f.q} || '%')
      ORDER BY (sku ILIKE ${f.q}) DESC, similarity(f_unaccent(name), f_unaccent(${f.q})) DESC
      LIMIT 500`;
    where.id = { in: ids.map((r) => r.id) };
  }
  const rows = await ctx.db.product.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

export async function listProductCategories(ctx: ServiceContext) {
  if (!ctx.actor) throw new DomainError('INVALID_STATE', 'Thiếu người thực hiện');
  assertAuthorized(ctx.actor, 'product.view');
  return ctx.db.productCategory.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: 'asc' } });
}
