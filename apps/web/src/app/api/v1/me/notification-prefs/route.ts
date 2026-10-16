import { NotificationPrefsInput, updateNotificationPrefs } from '@michio/core';
import { readJson, route } from '@/lib/api';

/** SPEC 6.12: người dùng tự bật/tắt từng loại thông báo Zalo (trừ "được giao lead"). */
export const PUT = route(async ({ req, ctx }) => ({ prefs: await updateNotificationPrefs(ctx, await readJson(req, NotificationPrefsInput)) }));
