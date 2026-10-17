import { facebookStatus, getSettings, isMockIntegrations } from '@michio/core';
import { FACEBOOK } from '@michio/channels';
import { formatDateTime } from '@michio/shared';
import Link from 'next/link';
import { loadPendingPages, oauthStateOwner } from '@/lib/facebook-oauth';
import { appBaseUrl, facebookClient } from '@/lib/integrations';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { FacebookActions, PagePicker, WindowSettings } from './actions';

export const metadata = { title: 'Facebook' };

const STATUS: Record<string, string> = { ACTIVE: 'Đang hoạt động', ERROR: 'Lỗi — cần kết nối lại', DISCONNECTED: 'Mất kết nối', DISABLED: 'Đã ngắt' };

/** S17 · Facebook Page (SPEC 5.2): connect the Page, webhook, messaging window policy. */
export default async function FacebookSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('integration.manage');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const [status, settings] = await Promise.all([
    facebookStatus(ctx),
    getSettings(ctx.db, ctx.orgId, ['facebook.standardWindowHours', 'facebook.humanAgentWindowDays', 'facebook.useHumanAgentTag']),
  ]);
  const pending = sp.pick && (await oauthStateOwner(sp.pick)) === user.id ? await loadPendingPages(sp.pick) : null;
  const mock = isMockIntegrations();
  const configured = Boolean(facebookClient());

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
        <h1 className="mt-1 text-2xl font-semibold">Facebook Page</h1>
        <p className="text-sm text-muted-foreground">Tin nhắn Messenger và form Lead Ads vào thẳng hộp thư, tự tạo lead và chia xoay vòng.</p>
      </div>
      {sp.error && <p className="rounded-lg bg-accent/10 p-3 text-sm text-accent-text" role="alert">Facebook báo lỗi: {sp.error}</p>}
      {sp.connected && <p className="rounded-lg bg-primary/10 p-3 text-sm" role="status">Đã kết nối Page.</p>}

      <div className="rounded-xl border border-border bg-surface p-4 text-sm" data-testid="facebook-integration">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
          <dt className="text-muted-foreground">Chế độ</dt>
          <dd className="font-medium">{mock ? 'Mô phỏng (MOCK_INTEGRATIONS=true)' : configured ? `Facebook thật · Graph API ${process.env.FB_GRAPH_VERSION || FACEBOOK.defaultGraphVersion}` : 'Chưa cấu hình (thiếu FB_APP_ID / FB_APP_SECRET)'}</dd>
          <dt className="text-muted-foreground">Webhook URL</dt>
          <dd className="break-all font-mono text-xs">{appBaseUrl()}/api/v1/webhooks/facebook</dd>
          <dt className="text-muted-foreground">Verify token</dt>
          <dd>{process.env.FB_VERIFY_TOKEN ? 'Đã đặt (FB_VERIFY_TOKEN)' : 'Chưa đặt FB_VERIFY_TOKEN'}</dd>
          <dt className="text-muted-foreground">Sự kiện gần nhất</dt>
          <dd>{status.lastWebhookAt ? formatDateTime(status.lastWebhookAt) : 'Chưa có'}{status.failedEvents ? ` · ${status.failedEvents} sự kiện lỗi (pnpm replay:webhook --id …)` : ''}</dd>
        </dl>
      </div>

      {pending && <PagePicker state={sp.pick!} pages={pending.pages.map((p) => ({ id: p.id, name: p.name }))} />}

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Page đã kết nối</h2>
        {status.pages.length === 0 && <p className="text-sm text-muted-foreground">Chưa có Page nào.</p>}
        <ul className="divide-y divide-border text-sm">
          {status.pages.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="facebook-page">
              <span>
                <span className="font-medium">{p.name}</span> <span className="text-muted-foreground">({p.pageId})</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === 'ACTIVE' ? 'bg-primary/10 text-primary dark:text-brand-green' : 'bg-accent/15 text-accent-text'}`}>{STATUS[p.status] ?? p.status}</span>
                <span className="block text-xs text-muted-foreground">{p.conversations} hội thoại{p.mock ? ' · mô phỏng' : ''}{!p.hasToken && !p.mock ? ' · chưa có token' : ''}{p.lastError ? ` · ${p.lastError}` : ''}</span>
              </span>
              {p.status !== 'DISABLED' && <FacebookActions disconnectId={p.id} />}
            </li>
          ))}
        </ul>
        <div className="mt-3"><FacebookActions connect connectLabel={status.pages.some((p) => p.status === 'ACTIVE') ? 'Kết nối lại / thêm Page' : 'Kết nối Facebook'} disabled={!configured} /></div>
        {!mock && (
          <p className="mt-3 text-xs text-muted-foreground">
            Quyền xin khi đăng nhập: {FACEBOOK.scopes.join(', ')}. Để nhận tin từ khách thật, app phải qua <strong>Meta App Review</strong> và xác minh doanh nghiệp (có thể mất vài ngày đến vài tuần).
          </p>
        )}
      </div>

      <WindowSettings standardHours={settings['facebook.standardWindowHours']} humanDays={settings['facebook.humanAgentWindowDays']} useHumanAgentTag={settings['facebook.useHumanAgentTag']} />
    </section>
  );
}
