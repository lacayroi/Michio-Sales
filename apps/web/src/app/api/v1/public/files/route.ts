// Signed, expiring file links (SPEC 6.6 "link chia sẻ có hạn"): Messenger fetches attachments and
// customers open quote PDFs here without an account. The bucket itself stays private.
import { verifyFileLink } from '@michio/core';
import { apiError } from '@/lib/api';
import { storage } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const key = q.get('k');
  if (!verifyFileLink(key, q.get('e'), q.get('s'))) return apiError(403, 'LINK_EXPIRED', 'Liên kết không hợp lệ hoặc đã hết hạn');
  const file = await storage().get(key!);
  if (!file) return apiError(404, 'NOT_FOUND', 'Không tìm thấy tệp');
  const name = key!.split('/').pop()!.replace(/^[0-9a-f-]{36}-/, '');
  return new Response(new Uint8Array(file.body), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `${file.contentType === 'application/pdf' || file.contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${name}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
