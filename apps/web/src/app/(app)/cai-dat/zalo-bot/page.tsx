import { prisma } from '@michio/db';
import { formatDateTime } from '@michio/shared';
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { mockMode, zaloBot, zaloWebhookUrl } from '@/lib/zalo-bot';
import { RegisterWebhook } from './register-webhook';

export const metadata = { title: 'Zalo Bot' };

/** S17 · Zalo Bot (SPEC 5.5): bot nội bộ báo việc cho sales — không nhắn khách. */
export default async function ZaloBotSettingsPage() {
  const user = await requireUser('integration.manage');
  const bot = zaloBot();
  const mock = mockMode();
  const [users, lastEvent] = await Promise.all([
    prisma.user.findMany({
      where: { orgId: user.orgId, deletedAt: null, status: { not: 'INACTIVE' }, role: { in: ['OWNER', 'MANAGER', 'SALES'] } },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: { id: true, fullName: true, role: true, zaloBotChatId: true },
    }),
    prisma.webhookEvent.findFirst({ where: { source: 'zalo-bot' }, orderBy: { receivedAt: 'desc' } }),
  ]);
  let info: { name?: string; webhook?: string | null; error?: string } = {};
  if (bot) {
    try {
      const [me, wh] = await Promise.all([bot.getMe(), bot.getWebhookInfo()]);
      info = { name: String(me.name ?? me.account_name ?? me.id), webhook: (wh.url as string | undefined) ?? null };
    } catch (err) {
      info = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">
          ← Cài đặt
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Zalo Bot nội bộ</h1>
        <p className="text-sm text-muted-foreground">Báo lead mới, nhắc việc, tổng kết 08:00 và thao tác nhanh cho sales trên Zalo. Bot chỉ nhắn 1-1 với nhân viên, không nhắn khách.</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 text-sm" data-testid="zalo-bot-integration">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
          <dt className="text-muted-foreground">Chế độ</dt>
          <dd className="font-medium">{!bot ? 'Chưa cấu hình (thiếu ZALO_BOT_TOKEN)' : mock ? 'Mô phỏng (MOCK_INTEGRATIONS=true)' : 'Đang chạy với Zalo thật'}</dd>
          {info.name && (
            <>
              <dt className="text-muted-foreground">Bot</dt>
              <dd>{info.name}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Webhook</dt>
          <dd className="break-all">{mock ? '— (mô phỏng)' : (info.webhook ?? 'Chưa đăng ký')}</dd>
          <dt className="text-muted-foreground">Tin gần nhất</dt>
          <dd>{lastEvent ? `${formatDateTime(lastEvent.receivedAt)} · ${lastEvent.status}` : 'Chưa có'}</dd>
          {info.error && (
            <>
              <dt className="text-muted-foreground">Lỗi</dt>
              <dd className="text-accent-text">{info.error}</dd>
            </>
          )}
        </dl>
        {!mock && bot && <RegisterWebhook url={zaloWebhookUrl()} />}
        {!bot && (
          <p className="mt-3 text-muted-foreground">
            Tạo bot tại bot.zaloplatforms.com, điền <code className="rounded bg-muted px-1">ZALO_BOT_TOKEN</code> và <code className="rounded bg-muted px-1">ZALO_BOT_WEBHOOK_SECRET</code> (8–256 ký tự) vào
            môi trường, đặt <code className="rounded bg-muted px-1">MOCK_INTEGRATIONS=false</code>, khởi động lại, rồi đăng ký webhook tại đây.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">Nhân viên đã kết nối ({users.filter((u) => u.zaloBotChatId).length}/{users.length})</h2>
        <ul className="divide-y divide-border text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex justify-between py-1.5">
              <span>{u.fullName}</span>
              <span className={u.zaloBotChatId ? 'font-medium text-primary dark:text-brand-green' : 'text-muted-foreground'}>{u.zaloBotChatId ? '✓ Đã kết nối' : 'Chưa kết nối'}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Mỗi người tự kết nối trong Hồ sơ → “Kết nối Zalo Bot”. Checklist go-live (M6): cả 3 sales phải kết nối.</p>
      </div>
    </section>
  );
}
