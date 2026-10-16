import { toLocalVnPhone } from '@michio/shared';
import { MessageCircle, Phone } from 'lucide-react';

/** SPEC 10.2: nút `tel:` và "Mở Zalo" cạnh mọi SĐT. */
export function PhoneLinks({ phone, compact = false }: { phone: string | null | undefined; compact?: boolean }) {
  if (!phone) return <span className="text-muted-foreground">—</span>;
  const local = toLocalVnPhone(phone);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium tabular-nums">{local}</span>
      <a
        href={`tel:${local}`}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted"
        aria-label={`Gọi ${local}`}
      >
        <Phone className="size-3.5" />
        {!compact && 'Gọi'}
      </a>
      <a
        href={`https://zalo.me/${local}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted"
        aria-label={`Mở Zalo ${local}`}
      >
        <MessageCircle className="size-3.5" />
        {!compact && 'Zalo'}
      </a>
    </span>
  );
}
