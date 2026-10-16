// Cursor pagination (SPEC §8): ?cursor=&limit= (default 20, max 100).
export interface PageParams {
  cursor?: string | null;
  limit?: number | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function pageArgs(p: PageParams) {
  const take = Math.min(Math.max(p.limit ?? 20, 1), 100);
  return {
    take: take + 1,
    ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
  };
}

export function toPage<T extends { id: string }>(rows: T[], p: PageParams): Page<T> {
  const take = Math.min(Math.max(p.limit ?? 20, 1), 100);
  const items = rows.slice(0, take);
  return { items, nextCursor: rows.length > take ? items[items.length - 1]!.id : null };
}
