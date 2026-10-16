// Zalo Bot command parser (SPEC 5.5). Pure: text in → command out.
// Command words are case-insensitive and accept missing diacritics ("NHẬN" = "nhan" = "NHAN").
import { normalizeVnPhone } from '@michio/shared';

export type LeadStageCode = 'TU_VAN' | 'BAO_GIA' | 'CHOT' | 'THUA';

export type BotCommand =
  | { kind: 'LEAD'; phone: string; name: string; note: string | null }
  | { kind: 'NHAN'; code: number }
  | { kind: 'TRA'; code: number; reason: string | null }
  | { kind: 'GOI'; code: number; note: string | null }
  | { kind: 'HEN'; code: number; dueAt: Date; content: string }
  | { kind: 'XONG'; taskCode: number }
  | { kind: 'HOMNAY' }
  | { kind: 'TRANGTHAI'; code: number; stage: LeadStageCode; reason: string | null }
  | { kind: 'NGHI' }
  | { kind: 'LAMVIEC' }
  | { kind: 'HELP' }
  | { kind: 'LINK'; code: string }
  | { kind: 'INVALID'; command: string; message: string }
  | { kind: 'UNKNOWN' };

export const BOT_HELP = [
  '📖 Lệnh Michio Sales Bot (không cần dấu, không phân biệt hoa thường):',
  'LEAD <SĐT> <tên - ghi chú> — tạo lead, chia xoay vòng',
  'NHAN <mã> — nhận lead',
  'TRA <mã> [lý do] — trả lead',
  'GOI <mã> [ghi chú] — ghi nhận đã liên hệ',
  'HEN <mã> <dd/mm hh:mm> <nội dung> — hẹn việc (vd: HEN 1234 mai 9h gọi lại)',
  'XONG <mã việc> — hoàn thành việc',
  'HOMNAY — việc & lead hôm nay',
  'TRANGTHAI <mã> TUVAN|BAOGIA|CHOT|THUA [lý do]',
  'NGHI / LAMVIEC — tạm dừng / tiếp tục nhận lead',
].join('\n');

/** Uppercase, no diacritics, đ→D. */
export function foldCommand(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase();
}

const ONE_WORD: Record<string, BotCommand['kind']> = {
  LEAD: 'LEAD',
  NHAN: 'NHAN',
  TRA: 'TRA',
  GOI: 'GOI',
  HEN: 'HEN',
  XONG: 'XONG',
  HOMNAY: 'HOMNAY',
  TRANGTHAI: 'TRANGTHAI',
  NGHI: 'NGHI',
  LAMVIEC: 'LAMVIEC',
  HELP: 'HELP',
  HUONGDAN: 'HELP',
  LENH: 'HELP',
  '?': 'HELP',
};
const TWO_WORDS: Record<string, BotCommand['kind']> = {
  'HOM NAY': 'HOMNAY',
  'TRANG THAI': 'TRANGTHAI',
  'LAM VIEC': 'LAMVIEC',
  'HUONG DAN': 'HELP',
};

const STAGES: Record<string, LeadStageCode> = {
  TUVAN: 'TU_VAN',
  TU_VAN: 'TU_VAN',
  BAOGIA: 'BAO_GIA',
  BAO_GIA: 'BAO_GIA',
  CHOT: 'CHOT',
  THUA: 'THUA',
};

const USAGE: Partial<Record<BotCommand['kind'], string>> = {
  LEAD: 'LEAD <SĐT> <tên - ghi chú>, vd: LEAD 0912345678 Chị Hoa - shop mẹ bé Hải Phòng',
  NHAN: 'NHAN <mã lead>, vd: NHAN 1234',
  TRA: 'TRA <mã lead> [lý do]',
  GOI: 'GOI <mã lead> [ghi chú]',
  HEN: 'HEN <mã lead> <dd/mm hh:mm> <nội dung>, vd: HEN 1234 17/10 15:00 gửi báo giá',
  XONG: 'XONG <mã việc>, vd: XONG 12',
  TRANGTHAI: 'TRANGTHAI <mã lead> TUVAN|BAOGIA|CHOT|THUA [lý do]',
};

const invalid = (kind: BotCommand['kind'], message?: string): BotCommand => ({
  kind: 'INVALID',
  command: kind,
  message: `${message ?? 'Sai cú pháp'}. Cách dùng: ${USAGE[kind] ?? kind}`,
});

const parseCode = (t: string | undefined) => {
  const m = t?.match(/^#?V?(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
};

const rest = (tokens: string[], from: number) => tokens.slice(from).join(' ').trim() || null;

// ---------- dates (Vietnam time, UTC+7, no DST) ----------
const OFFSET = 7 * 3600_000;
const DAY = 86_400_000;
const vnParts = (d: Date) => {
  const l = new Date(d.getTime() + OFFSET);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate() };
};
const vnDate = (y: number, m: number, d: number, hh: number, mm: number) => new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET);

function parseTime(token: string | undefined): { hh: number; mm: number } | null {
  // "15:00", "9.30", "15h", "9h30" — a bare number is not a time ("15" could be a quantity).
  const m = token?.match(/^(\d{1,2})(?:[:.](\d{2})|[hH](\d{2})?)$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? m[3] ?? 0);
  return hh < 24 && mm < 60 ? { hh, mm } : null;
}

/**
 * Due date for HEN: "<dd/mm[/yyyy]> <hh:mm>", "mai 9h", "nay 15:30", or just "15h" (today, or
 * tomorrow if already past). Returns the date and how many tokens it used.
 */
export function parseDue(tokens: string[], now: Date): { dueAt: Date; used: number } | 'INVALID_DATE' | null {
  const today = vnParts(now);
  const first = foldCommand(tokens[0] ?? '');
  let day: { y: number; m: number; d: number } | null = null;
  let used = 0;

  const dm = first.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    let y = dm[3] ? Number(dm[3]) : today.y;
    if (y < 100) y += 2000;
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return 'INVALID_DATE';
    // "05/01" written in December means next January.
    if (!dm[3] && vnDate(y, m, d, 23, 59) < new Date(now.getTime() - DAY)) y += 1;
    day = { y, m, d };
    used = 1;
  } else if (first === 'MAI' || first === 'NGAYMAI') {
    day = vnParts(new Date(now.getTime() + DAY));
    used = 1;
  } else if (first === 'NAY' || first === 'HOMNAY') {
    day = today;
    used = 1;
  } else if (first === 'HOM' && foldCommand(tokens[1] ?? '') === 'NAY') {
    day = today;
    used = 2;
  }

  const time = parseTime(tokens[used]);
  if (!time) return day ? 'INVALID_DATE' : null;
  used += 1;
  if (!day) {
    const candidate = vnDate(today.y, today.m, today.d, time.hh, time.mm);
    return { dueAt: candidate > now ? candidate : new Date(candidate.getTime() + DAY), used };
  }
  return { dueAt: vnDate(day.y, day.m, day.d, time.hh, time.mm), used };
}

/** LEAD: the phone may be written with spaces ("0912 345 678"); take the longest valid prefix. */
function splitPhone(tokens: string[]): { phone: string; used: number } | null {
  let best: { phone: string; used: number } | null = null;
  for (let k = 1; k <= Math.min(4, tokens.length); k++) {
    const candidate = tokens.slice(0, k).join('');
    if (!/^\+?[\d.-]+$/.test(candidate)) break;
    if (normalizeVnPhone(candidate)) best = { phone: candidate, used: k };
  }
  return best;
}

const LINK_CODE = /^\d{6}$/;

export function parseBotCommand(raw: string, now: Date = new Date()): BotCommand {
  const text = raw.trim();
  if (!text) return { kind: 'UNKNOWN' };
  if (LINK_CODE.test(text)) return { kind: 'LINK', code: text };

  const tokens = text.split(/\s+/);
  const two = foldCommand(`${tokens[0]} ${tokens[1] ?? ''}`).trim();
  let kind = TWO_WORDS[two];
  let argStart = 2;
  if (!kind) {
    kind = ONE_WORD[foldCommand(tokens[0]!)];
    argStart = 1;
  }
  if (!kind) return { kind: 'UNKNOWN' };
  const args = tokens.slice(argStart);

  switch (kind) {
    case 'HOMNAY':
    case 'NGHI':
    case 'LAMVIEC':
    case 'HELP':
      return { kind } as BotCommand;
    case 'LEAD': {
      const p = splitPhone(args);
      if (!p) return invalid('LEAD', args.length ? 'Số điện thoại không hợp lệ' : 'Thiếu số điện thoại');
      const note = rest(args, p.used);
      const name = note?.split(/\s+-\s+|[,;]/)[0]?.trim().slice(0, 120) || 'Khách Zalo';
      return { kind: 'LEAD', phone: p.phone, name, note };
    }
    case 'NHAN':
    case 'XONG': {
      const code = parseCode(args[0]);
      if (code === null) return invalid(kind, 'Thiếu mã');
      return kind === 'NHAN' ? { kind, code } : { kind, taskCode: code };
    }
    case 'TRA':
    case 'GOI': {
      const code = parseCode(args[0]);
      if (code === null) return invalid(kind, 'Thiếu mã lead');
      return kind === 'TRA' ? { kind, code, reason: rest(args, 1) } : { kind, code, note: rest(args, 1) };
    }
    case 'HEN': {
      const code = parseCode(args[0]);
      if (code === null) return invalid('HEN', 'Thiếu mã lead');
      const due = parseDue(args.slice(1), now);
      if (due === null) return invalid('HEN', 'Thiếu ngày giờ hẹn');
      if (due === 'INVALID_DATE') return invalid('HEN', 'Ngày giờ không hợp lệ');
      return { kind: 'HEN', code, dueAt: due.dueAt, content: rest(args, 1 + due.used) ?? 'Liên hệ lại khách' };
    }
    case 'TRANGTHAI': {
      const code = parseCode(args[0]);
      const stage = STAGES[foldCommand(args[1] ?? '')];
      if (code === null || !stage) return invalid('TRANGTHAI');
      return { kind: 'TRANGTHAI', code, stage, reason: rest(args, 2) };
    }
    default:
      return { kind: 'UNKNOWN' };
  }
}
