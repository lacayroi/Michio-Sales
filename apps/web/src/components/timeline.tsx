import type { Activity } from '@michio/db';
import { ASSIGNMENT_METHOD_LABELS, CALL_RESULT_LABELS, formatDateTime, formatVnd, LEAD_SOURCE_LABELS } from '@michio/shared';
import Link from 'next/link';

type Data = Record<string, unknown>;

function describe(a: Activity, users: Record<string, string>): { icon: string; text: string; note?: string; href?: string } {
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
    case 'MESSAGE_IN': {
      const n = Number(d.count ?? 1);
      return { icon: '💬', text: `Khách nhắn Messenger${n > 1 ? ` (${n} tin)` : ''}`, note: (d.last as string | undefined) ?? (d.preview as string | undefined), href: `/hop-thu?c=${d.conversationId as string}` };
    }
    case 'MESSAGE_OUT': {
      const n = Number(d.count ?? 1);
      return { icon: '📤', text: `${by} trả lời Messenger${n > 1 ? ` (${n} tin)` : ''}`, note: (d.last as string | undefined) ?? (d.preview as string | undefined), href: `/hop-thu?c=${d.conversationId as string}` };
    }
    case 'STAGE_CHANGE':
      return { icon: '➡️', text: `${by} chuyển giai đoạn: ${(d.toName as string) ?? (d.to as string)}`, note: d.note as string | undefined };
    case 'TASK_DONE':
      return { icon: '☑️', text: `${by} hoàn thành việc: ${d.title as string}` };
    case 'QUOTE': {
      const verb: Record<string, string> = { created: 'tạo', sent: 'gửi', accepted: 'ghi nhận khách đồng ý', rejected: 'ghi nhận khách từ chối', expired: 'hết hạn', approved: 'duyệt' };
      return { icon: '🧾', text: `${by} ${verb[d.kind as string] ?? d.kind} báo giá ${d.code as string}${d.total ? ` · ${formatVnd(Number(d.total))}` : ''}`, href: `/bao-gia/${d.quoteId as string}` };
    }
    case 'ORDER': {
      const verb: Record<string, string> = { created: 'tạo', delivered: 'giao xong', cancelled: 'hủy', paid: 'ghi nhận thanh toán' };
      return { icon: '📦', text: `${by} ${verb[d.kind as string] ?? d.kind} đơn ${d.code as string}${d.total ? ` · ${formatVnd(Number(d.total))}` : ''}`, href: `/don-hang/${d.orderId as string}` };
    }
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
        const { icon, text, note, href } = describe(a, users);
        return (
          <li key={a.id} className="flex gap-3 text-sm">
            <span aria-hidden className="w-5 shrink-0 text-center">{icon}</span>
            <div className="min-w-0">
              <p>{href ? <Link href={href} className="hover:underline">{text}</Link> : text}</p>
              {note && <p className="whitespace-pre-line text-muted-foreground">{note}</p>}
              <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
