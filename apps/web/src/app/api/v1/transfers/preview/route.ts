import { previewTransfer } from '@michio/core';
import { HttpError, route, searchParamsOf } from '@/lib/api';

export const GET = route(async ({ req, ctx }) => {
  const from = searchParamsOf(req).fromUserId;
  if (!from) throw new HttpError(422, 'VALIDATION_ERROR', 'Chọn người chuyển');
  return previewTransfer(ctx, from);
});
