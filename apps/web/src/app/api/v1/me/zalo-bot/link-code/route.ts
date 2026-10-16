import { createBotLinkCode } from '@michio/core';
import { route } from '@/lib/api';

/** §8 POST /me/zalo-bot/link-code — 6-digit code, valid 10 minutes, sent to the bot to link this account. */
export const POST = route(async ({ ctx }) => createBotLinkCode(ctx));
