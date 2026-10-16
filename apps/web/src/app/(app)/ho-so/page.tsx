import { BOT_NOTIFICATION_TYPES, zaloEnabled } from '@michio/core';
import { prisma } from '@michio/db';
import { formatDate, ROLE_LABELS, toLocalVnPhone } from '@michio/shared';
import { ChangePasswordForm } from '@/components/change-password-form';
import { requireUser } from '@/lib/session';
import { mockMode } from '@/lib/zalo-bot';
import { BotSimulator } from './bot-simulator';
import { NotificationPrefs } from './notification-prefs';
import { ZaloBotCard } from './zalo-bot-card';

export const metadata = { title: 'Hồ sơ' };

/** S18: kết nối Zalo Bot, thông báo, lịch nghỉ. */
export default async function ProfilePage() {
  const user = await requireUser();
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { zaloBotChatId: true, notificationPrefs: true, leaves: { where: { endAt: { gt: new Date() } }, orderBy: { startAt: 'asc' } } },
  });
  const linked = Boolean(me.zaloBotChatId);
  const mock = mockMode();
  const isManager = user.role === 'OWNER' || user.role === 'MANAGER';
  const prefs = BOT_NOTIFICATION_TYPES.filter((t) => t.type !== 'lead.queued' || isManager).map((t) => ({
    type: t.type,
    label: t.label,
    locked: 'locked' in t && t.locked,
    enabled: zaloEnabled(me.notificationPrefs, t.type),
  }));

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-2xl font-semibold">Hồ sơ</h1>
      <div className="rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="text-lg font-semibold">{user.fullName}</p>
        <p className="text-muted-foreground">
          {ROLE_LABELS[user.role]} · {user.email}
          {user.phone && ` · ${toLocalVnPhone(user.phone)}`}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Kết nối Zalo Bot</h2>
        <ZaloBotCard linked={linked} mock={mock} />
      </div>

      {mock && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-4">
          <h2 className="mb-1 font-semibold">Zalo Bot (mô phỏng)</h2>
          <p className="mb-3 text-sm text-muted-foreground">Chế độ demo (MOCK_INTEGRATIONS=true): khung chat này thay cho Zalo thật, đi qua đúng luồng webhook và lệnh bot.</p>
          <BotSimulator />
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Thông báo qua Zalo</h2>
        <NotificationPrefs items={prefs} disabled={!linked} />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">Lịch nghỉ</h2>
        {me.leaves.length ? (
          <ul className="text-sm">
            {me.leaves.map((l) => (
              <li key={l.id}>
                {formatDate(l.startAt)} – {formatDate(new Date(l.endAt.getTime() - 1))}
                {l.reason ? ` · ${l.reason}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Không có lịch nghỉ sắp tới.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Lịch nghỉ do quản lý cập nhật; trong thời gian nghỉ bạn không được chia lead. Tạm dừng nhận lead trong ngày: bấm trạng thái ở góc trên hoặc nhắn NGHI cho bot.</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Đổi mật khẩu</h2>
        <ChangePasswordForm />
      </div>
    </section>
  );
}
