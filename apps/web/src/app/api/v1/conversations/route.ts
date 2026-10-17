import { listConversations, unreadConversationCount } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => {
  const [page, unread] = await Promise.all([listConversations(ctx, searchParamsOf(req)), unreadConversationCount(ctx)]);
  return { ...page, unread };
});
