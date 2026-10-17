// WooCommerce keys (Read only, SPEC 5.6) — stored encrypted; GET returns status without secrets.
import { saveWooSettings, WooSettingsInput, wooStatus } from '@michio/core';
import { readJson, route } from '@/lib/api';

export const GET = route(async ({ ctx }) => wooStatus(ctx));
export const POST = route(async ({ req, ctx }) => saveWooSettings(ctx, await readJson(req, WooSettingsInput)));
