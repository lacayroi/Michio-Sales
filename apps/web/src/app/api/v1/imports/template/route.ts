import { buildImportTemplate } from '@michio/core';
import { route } from '@/lib/api';

export const GET = route(async () => {
  const buf = await buildImportTemplate();
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="mau-import-khach-si.xlsx"',
    },
  });
});
