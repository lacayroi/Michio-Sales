import { DELIVERY_STATUS_LABELS, LEAD_STATUS_LABELS, LIFECYCLE_LABELS, PAYMENT_STATUS_LABELS, PRIORITY_LABELS, QUOTE_STATUS_LABELS } from '@michio/shared';
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

const QUOTE_TONE: Record<keyof typeof QUOTE_STATUS_LABELS, string> = {
  DRAFT: 'bg-muted text-foreground',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  SENT: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
  ACCEPTED: 'bg-primary text-primary-foreground',
  REJECTED: 'bg-muted text-muted-foreground line-through',
  EXPIRED: 'bg-muted text-muted-foreground',
};

export function QuoteStatusBadge({ status }: { status: keyof typeof QUOTE_STATUS_LABELS }) {
  return <span className={cn(base, QUOTE_TONE[status])}>{QUOTE_STATUS_LABELS[status]}</span>;
}

const DELIVERY_TONE: Record<keyof typeof DELIVERY_STATUS_LABELS, string> = {
  PENDING: 'bg-muted text-foreground',
  PACKING: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  SHIPPING: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
  DELIVERED: 'bg-primary text-primary-foreground',
  CANCELLED: 'bg-muted text-muted-foreground line-through',
};

export function DeliveryBadge({ status }: { status: keyof typeof DELIVERY_STATUS_LABELS }) {
  return <span className={cn(base, DELIVERY_TONE[status])}>{DELIVERY_STATUS_LABELS[status]}</span>;
}

export function PaymentBadge({ status }: { status: keyof typeof PAYMENT_STATUS_LABELS }) {
  const tone = status === 'PAID' ? 'bg-primary/10 text-primary dark:text-brand-green' : status === 'PARTIAL' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' : 'bg-accent/15 text-accent-text';
  return <span className={cn(base, tone)}>{PAYMENT_STATUS_LABELS[status]}</span>;
}
