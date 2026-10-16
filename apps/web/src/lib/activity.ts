import { ASSIGNMENT_METHOD_LABELS, CALL_RESULT_LABELS, LEAD_SOURCE_LABELS } from '@michio/shared';

export interface TimelineItem {
  id: string;
  type: string;
  data: unknown;
  createdAt: string;
  userName: string | null;
}

type D = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : '');

const QUEUE_REASONS: Record<string, string> = {
  NO_RULE: 'không có luật chia phù hợp',
  MANUAL_RULE: 'luật yêu cầu giao tay',
  NO_CANDIDATE: 'không còn sales nhận được',
  MAX_REASSIGN: 'đã thu hồi quá số lần cho phép',
  UNASSIGNED_BY_CHOICE: 'chưa giao',
};

/** One-line Vietnamese description of a timeline entry (SPEC 6.9 dòng thời gian). */
export function describeActivity(a: TimelineItem): { icon: string; text: string; note?: string } {
  const d = (a.data ?? {}) as D;
  switch (a.type) {
    case 'CALL':
      return { icon: '📞', text: `Gọi điện — ${CALL_RESULT_LABELS[d.result as keyof typeof CALL_RESULT_LABELS] ?? 'đã gọi'}`, note: s(d.note) };
    case 'MEETING':
      return { icon: '🤝', text: 'Gặp khách', note: s(d.note) };
    case 'NOTE':
      return { icon: '📝', text: 'Ghi chú', note: s(d.note) };
    case 'ASSIGNMENT': {
      const action = s(d.action);
      if (action === 'ACCEPTED') return { icon: '✅', text: 'Đã nhận lead' };
      if (action === 'RETURNED') return { icon: '↩️', text: 'Trả lại lead', note: s(d.reason) };
      if (action === 'EXPIRED') return { icon: '⏰', text: 'Thu hồi do quá hạn nhận' };
      const method = ASSIGNMENT_METHOD_LABELS[d.method as keyof typeof ASSIGNMENT_METHOD_LABELS] ?? '';
      return { icon: '👤', text: `Giao cho ${s(d.toUserName) || 'sales'}${method ? ` (${method.toLowerCase()})` : ''}` };
    }
    case 'STAGE_CHANGE':
      return { icon: '🏷️', text: d.to === 'THUA' ? `Không thành công — ${s(d.lostReason)}` : `Chuyển giai đoạn ${s(d.to)}`, note: s(d.note) };
    case 'MERGE':
      return { icon: '🔗', text: `Gộp hồ sơ "${s(d.fromName)}"` };
    case 'SYSTEM': {
      const kind = s(d.kind);
      if (kind === 'RECONTACT') return { icon: '💬', text: s(d.text) || `Liên hệ lại qua ${LEAD_SOURCE_LABELS[d.source as keyof typeof LEAD_SOURCE_LABELS] ?? ''}`, note: s(d.note) };
      if (kind === 'QUEUED') return { icon: '⚠️', text: `Vào hàng chờ: ${QUEUE_REASONS[s(d.reason)] ?? s(d.reason)}` };
      if (kind === 'CONTACT_OVERDUE') return { icon: '⏰', text: 'Quá hạn liên hệ đầu tiên' };
      if (kind === 'IMPORTED') return { icon: '📥', text: 'Nhập từ file Excel' };
      return { icon: 'ℹ️', text: kind || 'Hệ thống' };
    }
    case 'MESSAGE_IN':
      return { icon: '💬', text: 'Khách nhắn', note: s(d.text) };
    case 'MESSAGE_OUT':
      return { icon: '📤', text: 'Đã nhắn khách', note: s(d.text) };
    case 'QUOTE':
      return { icon: '🧾', text: 'Báo giá', note: s(d.code) };
    case 'ORDER':
      return { icon: '📦', text: 'Đơn sỉ', note: s(d.code) };
    case 'TASK_DONE':
      return { icon: '☑️', text: 'Hoàn thành việc', note: s(d.title) };
    default:
      return { icon: '•', text: a.type };
  }
}
