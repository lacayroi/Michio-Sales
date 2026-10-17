import { isMockIntegrations, wooStatus } from '@michio/core';
import { formatDateTime } from '@michio/shared';
import Link from 'next/link';
import { appBaseUrl } from '@/lib/integrations';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { WooForm, WooSyncButtons } from './form';

export const metadata = { title: 'WooCommerce' };

/** S17 · WooCommerce (SPEC 5.6): khóa API quyền Read, đồng bộ sản phẩm 6 giờ/lần, webhook product.updated. */
export default async function WooPage() {
  const user = await requireUser('integration.manage');
  const s = await wooStatus(serviceContext(user));
  const mock = isMockIntegrations();
  const r = s.state.lastResult;
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
        <h1 className="mt-1 text-2xl font-semibold">WooCommerce — đồng bộ sản phẩm</h1>
        <p className="text-sm text-muted-foreground">Lấy mã, tên, danh mục, giá lẻ, ảnh, link, tình trạng còn hàng từ michiovietnam.com. Giá sỉ quản lý ở Bảng giá sỉ, không lấy từ website.</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 text-sm" data-testid="woo-status">
        <dl className="grid grid-cols-[11rem_1fr] gap-y-2">
          <dt className="text-muted-foreground">Chế độ</dt><dd className="font-medium">{mock ? 'Mô phỏng (MOCK_INTEGRATIONS=true)' : s.configured ? `Website thật · ${s.baseUrl}` : 'Chưa có khóa API'}</dd>
          <dt className="text-muted-foreground">Lần đồng bộ gần nhất</dt>
          <dd>{s.state.lastSyncAt ? `${formatDateTime(new Date(s.state.lastSyncAt))}${r ? ` · ${r.mode === 'full' ? 'toàn bộ' : 'phần thay đổi'}: +${r.created} mới, ${r.updated} cập nhật` : ''}` : 'Chưa đồng bộ'}</dd>
          {s.state.lastError && (<><dt className="text-muted-foreground">Lỗi</dt><dd className="text-accent-text">{s.state.lastError}</dd></>)}
          <dt className="text-muted-foreground">Sản phẩm từ Woo</dt><dd>{s.counts.products} · {s.counts.outOfStock} hết hàng · <Link href="/san-pham?needsSku=true" className="hover:underline">{s.counts.needsSku} cần bổ sung mã</Link></dd>
          <dt className="text-muted-foreground">Webhook (tùy chọn)</dt><dd className="break-all font-mono text-xs">{appBaseUrl()}/api/v1/webhooks/woocommerce — chủ đề Product updated, secret = WOO_WEBHOOK_SECRET</dd>
        </dl>
        <div className="mt-3"><WooSyncButtons disabled={!s.configured && !mock} /></div>
      </div>
      {!mock && <WooForm baseUrl={s.baseUrl ?? 'https://michiovietnam.com'} source={s.source} />}
    </section>
  );
}
