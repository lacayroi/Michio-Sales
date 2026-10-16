import { assertAuthorized } from '@michio/auth';
import { buildImportTemplate, type ImportAssign, parseCustomerWorkbook } from '@michio/core';
import { prisma } from '@michio/db';
import { NextResponse } from 'next/server';
import { apiError, authed } from '@/lib/api';
import { getEffects } from '@/lib/effects';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;

/** File mẫu (Phụ lục A). */
export const GET = authed(async (_req, { user }) => {
  assertAuthorized(user, 'import.manage');
  const buf = await buildImportTemplate();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="mau-import-khach-si.xlsx"',
    },
  });
});

/**
 * multipart: file, assign (auto|user|none), userId?, dryRun ("1" → preview only).
 * Preview → the UI shows row errors → the same file is posted again without dryRun → job (SPEC 6.2).
 */
export const POST = authed(async (req, { actor }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return apiError(422, 'VALIDATION_ERROR', 'Hãy chọn file Excel (.xlsx)');
  if (file.size > MAX_BYTES) return apiError(413, 'FILE_TOO_LARGE', 'File tối đa 10 MB');
  const preview = await parseCustomerWorkbook(prisma, actor, await file.arrayBuffer());
  if (form!.get('dryRun') === '1') {
    return NextResponse.json({ ...preview, rows: preview.rows.slice(0, 20), validRows: preview.rows.length });
  }

  const mode = String(form!.get('assign') ?? 'auto');
  const userId = String(form!.get('userId') ?? '');
  const assign: ImportAssign = mode === 'user' && userId ? { mode: 'user', userId } : mode === 'none' ? { mode: 'none' } : { mode: 'auto' };
  if (!preview.rows.length) return apiError(422, 'NO_VALID_ROWS', 'Không có dòng hợp lệ để import');
  const job = await getEffects().queues.import.add('customers', { actor, rows: preview.rows, assign, fileName: file.name });
  return NextResponse.json({ id: job.id, validRows: preview.rows.length, skipped: preview.errors.length }, { status: 202 });
});
