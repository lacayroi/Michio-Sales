import { assertAuthorized } from '@michio/auth';
import { type ImportJobData, previewCustomerImport, QUEUES } from '@michio/core';
import { HttpError, route } from '@/lib/api';
import { queue } from '@/lib/services';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * multipart/form-data: file, mode = preview | commit, ownerMode = ROUND_ROBIN | ONE_USER | NONE, userId?
 * preview → row-level errors, nothing written. commit → background job (GET /imports/:id for progress).
 */
export const POST = route(async ({ req, ctx, user }) => {
  assertAuthorized(user, 'import.manage');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'VALIDATION_ERROR', 'Chọn file Excel (.xlsx)');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'File tối đa 10 MB');
  const mode = form?.get('mode') === 'commit' ? 'commit' : 'preview';
  const ownerMode = String(form?.get('ownerMode') ?? 'ROUND_ROBIN') as ImportJobData['options']['ownerMode'];
  if (!['ROUND_ROBIN', 'ONE_USER', 'NONE'].includes(ownerMode)) throw new HttpError(422, 'VALIDATION_ERROR', 'Tùy chọn giao không hợp lệ');
  const userId = form?.get('userId') ? String(form.get('userId')) : undefined;
  if (ownerMode === 'ONE_USER' && !userId) throw new HttpError(422, 'VALIDATION_ERROR', 'Chọn người nhận');

  const preview = await previewCustomerImport(ctx, await file.arrayBuffer());
  if (mode === 'preview') return { ...preview, rows: preview.rows.filter((r) => r.errors.length).slice(0, 500) };
  if (!preview.valid) throw new HttpError(422, 'VALIDATION_ERROR', 'Không có dòng hợp lệ để nhập');

  const data: ImportJobData = { orgId: ctx.orgId, actorId: user.id, rows: preview.rows.filter((r) => r.data), options: { ownerMode, userId }, fileName: file.name };
  const job = await queue(QUEUES.import).add('customers', data, { removeOnComplete: { age: 7 * 86_400 }, removeOnFail: { age: 7 * 86_400 } });
  return { importId: job.id, valid: preview.valid, invalid: preview.invalid };
}, { status: 202 });
