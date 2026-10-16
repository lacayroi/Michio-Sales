import { formatDateTime } from '@michio/shared';
import { describeActivity, type TimelineItem } from '@/lib/activity';

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">Chưa có hoạt động</p>;
  return (
    <ol className="flex flex-col" data-testid="timeline">
      {items.map((a) => {
        const d = describeActivity(a);
        return (
          <li key={a.id} className="flex gap-3 border-b border-border py-2.5 last:border-0">
            <span aria-hidden className="w-5 shrink-0 text-center">
              {d.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{d.text}</span>
                {a.userName && <span className="text-muted-foreground"> · {a.userName}</span>}
              </p>
              {d.note && <p className="text-sm whitespace-pre-line text-muted-foreground">{d.note}</p>}
              <p className="text-xs text-muted-foreground">{formatDateTime(new Date(a.createdAt))}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
