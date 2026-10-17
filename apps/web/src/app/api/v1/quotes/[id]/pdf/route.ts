// GET /quotes/:id/pdf — preview (inline) or download (?download=1) for sending on Zalo (SPEC 6.6).
import { getQuote } from '@michio/core';
import { route, searchParamsOf } from '@/lib/api';
import { quotePdf } from '@/lib/integrations';

export const GET = route<{ id: string }>(async ({ req, ctx, params }) => {
  await getQuote(ctx, params.id); // permission check
  const { body, code } = await quotePdf(params.id);
  const disposition = searchParamsOf(req).download ? 'attachment' : 'inline';
  return new Response(new Uint8Array(body), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${code}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
});
