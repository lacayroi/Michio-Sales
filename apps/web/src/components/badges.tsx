import { LEAD_STATUS_LABELS, LIFECYCLE_LABELS, PRIORITY_LABELS } from '@michio/shared';
import { cn } from '@/lib/utils';

const base = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold';

export function PriorityBadge({ priority }: { priority: keyof typeof PRIORITY_LABELS }) {
  return (
    <span
      className={cn(base, priority === 'HOT' ? 'bg-accent text-accent-foreground' : priority === 'WARM' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' : 'bg-muted text-muted-foreground')}
    >
      {priority === 'HOT' ? '🔥 ' : ''}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

const STATUS_TONE: Record<keyof typeof LEAD_STATUS_LABELS, string> = {
  NEW: 'bg-muted text-foreground',
  UNASSIGNED: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  ASSIGNED: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
  IN_PROGRESS: 'bg-primary/10 text-primary dark:text-brand-green',
  WON: 'bg-primary text-primary-foreground',
  LOST: 'bg-muted text-muted-foreground line-through',
};

export function LeadStatusBadge({ status }: { status: keyof typeof LEAD_STATUS_LABELS }) {
  return <span className={cn(base, STATUS_TONE[status])}>{LEAD_STATUS_LABELS[status]}</span>;
}

export function LifecycleBadge({ lifecycle }: { lifecycle: keyof typeof LIFECYCLE_LABELS }) {
  const tone = lifecycle === 'AT_RISK' ? 'bg-accent/15 text-accent-text' : lifecycle === 'DORMANT' ? 'bg-muted text-muted-foreground' : lifecycle === 'PROSPECT' ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary dark:text-brand-green';
  return <span className={cn(base, tone)}>{LIFECYCLE_LABELS[lifecycle]}</span>;
}
