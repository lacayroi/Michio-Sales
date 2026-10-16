import { assertAuthorized } from '@michio/auth';
import { recordAudit } from '@michio/core';
import { prisma } from '@michio/db';
import { HttpError, route } from '@/lib/api';
import { mockMode, zaloBot, zaloWebhookUrl } from '@/lib/zalo-bot';

/** Zalo Bot status for the integrations screen (Owner). */
export const GET = route(async ({ user }) => {
  assertAuthorized(user, 'integration.manage');
  const bot = zaloBot();
  const linked = await prisma.user.count({ where: { orgId: user.orgId, deletedAt: null, zaloBotChatId: { not: null } } });
  if (!bot) return { mode: 'disabled', linked, webhookUrl: zaloWebhookUrl() };
  try {
    const [me, webhook] = await Promise.all([bot.getMe(), bot.getWebhookInfo()]);
    return { mode: bot.mode, linked, bot: me, webhook, webhookUrl: zaloWebhookUrl(), secretConfigured: Boolean(process.env.ZALO_BOT_WEBHOOK_SECRET) };
  } catch (err) {
    return { mode: bot.mode, linked, error: err instanceof Error ? err.message : String(err), webhookUrl: zaloWebhookUrl() };
  }
});

/** Register the webhook with Zalo (setWebhook: HTTPS URL + secret_token 8–256 chars). */
export const POST = route(async ({ user, ctx }) => {
  assertAuthorized(user, 'integration.manage');
  const bot = zaloBot();
  if (!bot) throw new HttpError(409, 'NOT_CONFIGURED', 'Chưa cấu hình ZALO_BOT_TOKEN');
  if (mockMode()) throw new HttpError(409, 'MOCK_MODE', 'Đang chạy chế độ mô phỏng (MOCK_INTEGRATIONS=true)');
  const url = zaloWebhookUrl();
  const secret = process.env.ZALO_BOT_WEBHOOK_SECRET;
  if (!url || !secret) throw new HttpError(409, 'NOT_CONFIGURED', 'Thiếu APP_URL hoặc ZALO_BOT_WEBHOOK_SECRET');
  let result: Record<string, unknown>;
  try {
    result = await bot.setWebhook(url, secret);
  } catch (err) {
    throw new HttpError(502, 'ZALO_BOT_ERROR', err instanceof Error ? err.message : String(err));
  }
  await recordAudit(prisma, { orgId: ctx.orgId, actorId: user.id, via: 'WEB', action: 'integration.zaloBot.setWebhook', entityType: 'ChannelAccount', entityId: 'zalo-bot', after: { url }, ip: ctx.ip });
  return { ok: true, result };
});
