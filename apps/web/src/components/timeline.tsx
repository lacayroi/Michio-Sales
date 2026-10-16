import type { Activity } from '@michio/db';
import { ASSIGNMENT_METHOD_LABELS, CALL_RESULT_LABELS, formatDateTime, LEAD_SOURCE_LABELS } from '@michio/shared';

type Data = Record<string, unknown>;

function describe(a: Activity, users: Record<string, string>): { icon: string; text: string; note?: string } {
  const d = (a.data ?? {}) as Data;
  const who = (id: unknown) => (typeof id === 'string' ? (users[id] ?? 'người dùng đã xóa') : '');
  const by = a.userId ? who(a.userId) : 'Hệ thống';
  switch (a.type) {
    case 'ASSIGNMENT':
      if (d.kind === 'accepted') return { icon: '✅', text: `${by} đã nhận lead` };
      if (d.kind === 'returned') return { icon: '↩️', text: `${who(d.fromUserId)} trả lead`, note: d.reason as string | undefined };
      if (d.kind === 'expired') return { icon: '⏰', text: `Thu hồi từ ${who(d.fromUserId)} (quá hạn nhận)` };
      return { icon: '🔔', text: `Giao cho ${(d.toUserName as string) ?? who(d.toUserId)} · ${ASSIGNMENT_METHOD_LABELS[d.method as keyof typeof ASSIGNMENT_METHOD_LABELS] ?? ''}` };
    case 'CALL':
      return { icon: '📞', text: `${by} gọi điện · ${CALL_RESULT_LABELS[d.result as keyof typeof CALL_RESULT_LABELS] ?? ''}`, note: d.note as string | undefined };
    case 'MEETING':
      return { icon: '🤝', text: `${by} gặp khách`, note: d.note as string | undefined };
    case 'NOTE':
      return { icon: '📝', text: `${by} ghi chú`, note: d.note as string | undefined };
    case 'MERGE':
      return { icon: '🔗', text: `${by} gộp hồ sơ "${d.fromName as string}"` };
    case 'SYSTEM':
      if (d.kind === 'created') return { icon: '✨', text: `Lead mới từ ${LEAD_SOURCE_LABELS[d.source as keyof typeof LEAD_SOURCE_LABELS] ?? d.source}` };
      if (d.kind === 'recontact') return { icon: '💬', text: (d.label as string) ?? 'Liên hệ lại', note: d.note as string | undefined };
      if (d.kind === 'queued') return { icon: '⚠️', text: 'Vào hàng chờ giao tay', note: d.reason as string | undefined };
      return { icon: 'ℹ️', text: String(d.kind ?? 'Hệ thống') };
    default:
      return { icon: '•', text: a.type };
  }
}

export function Timeline({ items, users }: { items: Activity[]; users: Record<string, string> }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Chưa có hoạt động.</p>;
  return (
    <ol className="flex flex-col gap-3" data-testid="timeline">
      {items.map((a) => {
        const { icon, text, note } = describe(a, users);
        return (
          <li key={a.id} className="flex gap-3 text-sm">
            <span aria-hidden className="w-5 shrink-0 text-center">{icon}</span>
            <div className="min-w-0">
              <p>{text}</p>
              {note && <p className="whitespace-pre-line text-muted-foreground">{note}</p>}
              <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
