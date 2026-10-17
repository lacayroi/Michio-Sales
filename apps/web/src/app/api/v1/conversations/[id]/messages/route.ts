// GET thread (older pages with ?before=ISO) · POST send text / product / file (SPEC 6.4).
// Files are stored privately in S3 and sent to Messenger as a signed, expiring link.
import { buildProductMessages, getConversation, type OutboundInput, queueConversationMessages, signedFilePath, storageKey } from '@michio/core';
import { z } from 'zod';
import { HttpError, readJson, route, searchParamsOf } from '@/lib/api';
import { appBaseUrl, storage } from '@/lib/integrations';

/** Messenger accepts attachments up to 25 MB. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_LINK_TTL = 7 * 86_400;

export const GET = route<{ id: string }>(async ({ req, ctx, params }) => {
  const sp = searchParamsOf(req);
  const before = sp.before ? new Date(sp.before) : undefined;
  const r = await getConversation(ctx, params.id, { before: before && !Number.isNaN(+before) ? before : undefined });
  return { messages: r.messages, hasMore: r.hasMore, window: r.window };
});

const Body = z.object({
  kind: z.enum(['text', 'product']).default('text'),
  text: z.string().max(2000).optional(),
  productId: z.string().optional(),
  idempotencyKey: z.string().max(80).optional(),
});

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  let inputs: OutboundInput[];
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new HttpError(422, 'VALIDATION_ERROR', 'Chưa chọn tệp');
    if (file.size > MAX_FILE_BYTES) throw new HttpError(422, 'VALIDATION_ERROR', 'Tệp tối đa 25 MB');
    const key = storageKey(ctx.orgId, 'attachments', file.name);
    await storage().put(key, Buffer.from(await file.arrayBuffer()), file.type || 'application/octet-stream');
    const url = `${appBaseUrl()}${signedFilePath(key, ATTACHMENT_LINK_TTL)}`;
    inputs = [{ kind: file.type.startsWith('image/') ? 'image' : 'file', attachmentUrl: url, meta: { fileName: file.name, size: file.size, storageKey: key }, idempotencyKey: String(form.get('idempotencyKey') ?? '') || undefined }];
    const caption = String(form.get('text') ?? '').trim();
    if (caption) inputs.push({ kind: 'text', text: caption });
  } else {
    const b = await readJson(req, Body);
    if (b.kind === 'product') {
      if (!b.productId) throw new HttpError(422, 'VALIDATION_ERROR', 'Chưa chọn sản phẩm');
      inputs = (await buildProductMessages(ctx, b.productId)).map((m) => ({ ...m, idempotencyKey: b.idempotencyKey }));
    } else {
      inputs = [{ kind: 'text', text: b.text ?? '', idempotencyKey: b.idempotencyKey }];
    }
  }
  const r = await queueConversationMessages(ctx, params.id, inputs);
  return { messages: r.messages };
}, { status: 201 });
