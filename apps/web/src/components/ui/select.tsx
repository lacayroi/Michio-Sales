import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-lg border border-border bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:text-sm',
        className,
      )}
      {...props}
    />
  );
}
