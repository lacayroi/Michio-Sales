import { can } from '@michio/auth/permissions';
import { listPriceLists, listProductCategories, searchProducts } from '@michio/core';
import { formatDateTime, formatVnd } from '@michio/shared';
import { Package } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';
import { EditProductButton, NewPriceListButton } from './editors';

export const metadata = { title: 'Sản phẩm & bảng giá' };

type SP = Record<string, string | undefined>;

/** S13 — danh mục đồng bộ WooCommerce + bảng giá sỉ theo cấp (SPEC 5.6, 6.6). */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('priceList.manage');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const tab = sp.tab === 'bang-gia' ? 'bang-gia' : 'san-pham';
  const [products, categories, lists] = await Promise.all([
    tab === 'san-pham'
      ? searchProducts(ctx, { q: sp.q, categoryId: sp.categoryId, inStock: sp.inStock as never, includeInactive: true, cursor: sp.cursor, limit: 50 })
      : Promise.resolve({ items: [], nextCursor: null }),
    listProductCategories(ctx),
    listPriceLists(ctx),
  ]);
  const needsSku = sp.needsSku === 'true';
  const items = needsSku ? products.items.filter((p) => p.needsSku) : products.items;
  const canEdit = can(user.role, 'product.update');
  const next = products.nextCursor ? `?${new URLSearchParams({ ...(sp as Record<string, string>), cursor: products.nextCursor })}` : null;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Sản phẩm & bảng giá</h1>
        {can(user.role, 'integration.manage') && <Link href="/cai-dat/woocommerce" className={buttonVariants({ variant: 'outline' })}>Đồng bộ WooCommerce</Link>}
      </div>
      <nav className="flex gap-1 border-b border-border" aria-label="Mục">
        {[['san-pham', 'Sản phẩm'], ['bang-gia', `Bảng giá sỉ (${lists.length})`]].map(([k, label]) => (
          <Link key={k} href={`/san-pham?tab=${k}`} aria-current={tab === k ? 'page' : undefined} className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === k ? 'border-brand-green' : 'border-transparent text-muted-foreground hover:text-foreground')}>{label}</Link>
        ))}
      </nav>

      {tab === 'bang-gia' ? (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end"><NewPriceListButton /></div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((l) => (
              <li key={l.id}>
                <Link href={`/san-pham/bang-gia/${l.id}`} className="block rounded-xl border border-border bg-surface p-4 hover:bg-muted" data-testid="price-list">
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-sm text-muted-foreground">Cấp {l.tier} · {l._count.items} mã hàng · {l._count.customers} khách gán riêng</p>
                  {(l.validFrom || l.validTo) && <p className="text-xs text-muted-foreground">Hiệu lực {l.validFrom ? formatDateTime(l.validFrom).slice(0, 10) : '…'} – {l.validTo ? formatDateTime(l.validTo).slice(0, 10) : '…'}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <form className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-5" role="search" aria-label="Lọc sản phẩm">
            <Input name="q" defaultValue={sp.q} placeholder="Tên / mã (không dấu)" aria-label="Tìm sản phẩm" className="col-span-2" />
            <Select name="categoryId" defaultValue={sp.categoryId ?? ''} aria-label="Danh mục">
              <option value="">Mọi danh mục</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select name="inStock" defaultValue={sp.inStock ?? ''} aria-label="Tồn kho">
              <option value="">Còn / hết hàng</option><option value="true">Còn hàng</option><option value="false">Hết hàng</option>
            </Select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="needsSku" value="true" defaultChecked={needsSku} className="size-4 accent-[var(--primary)]" />Cần bổ sung mã</label>
            <button type="submit" className={buttonVariants({ variant: 'outline', className: 'col-span-2 sm:col-span-1' })}>Lọc</button>
          </form>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Sản phẩm</th><th className="p-3">Quy cách</th><th className="p-3 text-right">Giá lẻ (web)</th><th className="p-3">Tình trạng</th><th className="p-3">Báo giá</th><th className="w-12" /></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Không có sản phẩm</td></tr>}
                {items.map((p) => (
                  <tr key={p.id} className={cn(!p.isActive && 'opacity-60')}>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="size-10 rounded object-cover" />
                        ) : <span className="flex size-10 items-center justify-center rounded bg-muted"><Package className="size-4 text-muted-foreground" /></span>}
                        <div>
                          <p className="font-medium">{p.productUrl ? <a href={p.productUrl} target="_blank" rel="noreferrer" className="hover:underline">{p.name}</a> : p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.sku}{p.needsSku && <span className="text-accent-text"> · cần bổ sung mã</span>}{p.wooId ? ` · Woo #${p.wooId}` : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">{p.unitsPerCase ? `${p.unitsPerCase} ${p.unit ?? ''}/thùng` : (p.unit ?? '—')}</td>
                    <td className="p-3 text-right tabular-nums">{p.retailPrice ? formatVnd(p.retailPrice) : '—'}</td>
                    <td className="p-3">{!p.isActive ? 'Ngừng bán' : p.inStock ? 'Còn hàng' : <span className="text-accent-text">Hết hàng</span>}</td>
                    <td className="p-3">{p.showInQuote ? 'Hiện' : 'Ẩn'}</td>
                    <td className="p-3">{canEdit && <EditProductButton product={{ id: p.id, sku: p.sku, name: p.name, unit: p.unit, unitsPerCase: p.unitsPerCase, showInQuote: p.showInQuote }} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {next && <div className="flex justify-center"><Link href={next} className={buttonVariants({ variant: 'outline' })}>Trang sau →</Link></div>}
        </>
      )}
    </section>
  );
}
