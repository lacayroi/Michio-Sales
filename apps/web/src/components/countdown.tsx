'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h} giờ ${m} phút` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Live countdown to an accept deadline (S2 "đếm ngược"). Red under 3 minutes. */
export function Countdown({ deadline, className }: { deadline: string; className?: string }) {
  const target = new Date(deadline).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className={className}>…</span>;
  const left = target - now;
  return (
    <span className={cn('font-semibold tabular-nums', left < 3 * 60_000 && 'text-accent-text', className)} aria-live="off">
      {left <= 0 ? 'Đã quá hạn' : `Còn ${fmt(left)}`}
    </span>
  );
}
