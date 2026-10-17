import { importPriceList } from '@michio/core';
import { HttpError, route } from '@/lib/api';

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const file = (await req.formData()).get('file');
  if (!(file instanceof File) || !file.size) throw new HttpError(422, 'VALIDATION_ERROR', 'Chưa chọn file Excel');
  if (file.size > 10 * 1024 * 1024) throw new HttpError(422, 'VALIDATION_ERROR', 'File tối đa 10 MB');
  return importPriceList(ctx, params.id, Buffer.from(await file.arrayBuffer()));
});
