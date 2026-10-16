import { toLocalVnPhone } from '@michio/shared';
import { MessageCircle, Phone } from 'lucide-react';

/** `tel:` and "Mở Zalo" next to every phone number (SPEC 10.2). */
export function PhoneActions({ phone, compact }: { phone: string | null; compact?: boolean }) {
  if (!phone) return <span className="text-muted-foreground">—</span>;
  const local = toLocalVnPhone(phone);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tabular-nums">{local}</span>
      <a href={`tel:${local}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted" aria-label={`Gọi ${local}`}>
        <Phone className="size-3.5" aria-hidden />
        {!compact && 'Gọi'}
      </a>
      <a
        href={`https://zalo.me/${local}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
        aria-label={`Mở Zalo ${local}`}
      >
        <MessageCircle className="size-3.5" aria-hidden />
        {!compact && 'Zalo'}
      </a>
    </span>
  );
}
