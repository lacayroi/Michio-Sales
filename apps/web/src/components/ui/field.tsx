import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

/** Label + control + inline error, consistently spaced. */
export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-accent-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-sm font-medium text-accent-text">
      {message}
    </p>
  );
}
