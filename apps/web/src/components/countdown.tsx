'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** Live "còn 04:12" until an accept deadline; turns red under 3 minutes (SPEC 5.5 nhắc sắp hết hạn). */
export function Countdown({ deadline, className }: { deadline: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className={className}>…</span>;
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <span className={cn('font-semibold text-accent-text', className)}>Đã quá hạn</span>;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h > 0 ? `${h} giờ ${String(m).padStart(2, '0')} phút` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return (
    <span className={cn('font-semibold tabular-nums', ms < 3 * 60_000 && 'text-accent-text', className)} aria-label={`Còn ${text}`}>
      còn {text}
    </span>
  );
}
