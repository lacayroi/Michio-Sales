import { LEAD_STATUS_LABELS, LIFECYCLE_LABELS, PRIORITY_LABELS } from '@michio/shared';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<keyof typeof LEAD_STATUS_LABELS, string> = {
  NEW: 'bg-muted text-foreground',
  UNASSIGNED: 'border border-accent-text text-accent-text',
  ASSIGNED: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  IN_PROGRESS: 'bg-primary/15 text-foreground',
  WON: 'bg-primary text-primary-foreground',
  LOST: 'bg-muted text-muted-foreground line-through',
};

export function LeadStatusBadge({ status }: { status: keyof typeof LEAD_STATUS_LABELS }) {
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_STYLE[status])}>{LEAD_STATUS_LABELS[status]}</span>;
}

/** Red is reserved for HOT (SPEC 10.1). */
export function PriorityBadge({ priority }: { priority: keyof typeof PRIORITY_LABELS }) {
  if (priority === 'HOT') return <span className="inline-flex rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">🔥 HOT</span>;
  return <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{PRIORITY_LABELS[priority]}</span>;
}

export function LifecycleBadge({ lifecycle }: { lifecycle: keyof typeof LIFECYCLE_LABELS }) {
  const warn = lifecycle === 'AT_RISK' || lifecycle === 'DORMANT';
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', warn ? 'border border-accent-text text-accent-text' : 'bg-muted text-foreground')}>
      {LIFECYCLE_LABELS[lifecycle]}
    </span>
  );
}
