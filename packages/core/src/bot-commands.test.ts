import { describe, expect, it } from 'vitest';
import { parseBotCommand } from './bot-commands';

// Thursday 15/10/2026 10:00 Vietnam time
const NOW = new Date('2026-10-15T10:00:00+07:00');
const vn = (s: string) => new Date(`${s}+07:00`);
const p = (t: string) => parseBotCommand(t, NOW);

describe('parseBotCommand — SPEC 5.5 commands, with or without diacritics', () => {
  it.each([
    ['NHAN 1234', { kind: 'NHAN', code: 1234 }],
    ['nhận #1234', { kind: 'NHAN', code: 1234 }],
    ['Nhan 1234', { kind: 'NHAN', code: 1234 }],
    ['TRA 1234', { kind: 'TRA', code: 1234, reason: null }],
    ['trả 1234 không đúng khu vực', { kind: 'TRA', code: 1234, reason: 'không đúng khu vực' }],
    ['GOI 1234 đã tư vấn matcha', { kind: 'GOI', code: 1234, note: 'đã tư vấn matcha' }],
    ['gọi 1234', { kind: 'GOI', code: 1234, note: null }],
    ['XONG 12', { kind: 'XONG', taskCode: 12 }],
    ['xong V12', { kind: 'XONG', taskCode: 12 }],
    ['HOMNAY', { kind: 'HOMNAY' }],
    ['hôm nay', { kind: 'HOMNAY' }],
    ['NGHỈ', { kind: 'NGHI' }],
    ['lam viec', { kind: 'LAMVIEC' }],
    ['LÀMVIỆC', { kind: 'LAMVIEC' }],
    ['help', { kind: 'HELP' }],
    ['Hướng dẫn', { kind: 'HELP' }],
    ['TRANGTHAI 1234 BAOGIA', { kind: 'TRANGTHAI', code: 1234, stage: 'BAO_GIA', reason: null }],
    ['trạng thái 1234 thua giá cao', { kind: 'TRANGTHAI', code: 1234, stage: 'THUA', reason: 'giá cao' }],
    ['TRANGTHAI 1234 tuvan', { kind: 'TRANGTHAI', code: 1234, stage: 'TU_VAN', reason: null }],
    ['123456', { kind: 'LINK', code: '123456' }],
    ['xin chào', { kind: 'UNKNOWN' }],
    ['', { kind: 'UNKNOWN' }],
  ])('%s', (text, expected) => {
    expect(p(text)).toEqual(expected);
  });

  it('LEAD: phone + name before " - " + full note (SPEC example)', () => {
    expect(p('LEAD 0912345678 Chị Hoa - shop mẹ bé Hải Phòng - quan tâm matcha, bánh kẹo')).toEqual({
      kind: 'LEAD',
      phone: '0912345678',
      name: 'Chị Hoa',
      note: 'Chị Hoa - shop mẹ bé Hải Phòng - quan tâm matcha, bánh kẹo',
    });
  });

  it('LEAD: phone written with spaces, lowercase command, no name', () => {
    expect(p('lead 0912 345 678 Anh Tùng')).toMatchObject({ phone: '0912345678', name: 'Anh Tùng' });
    expect(p('LEAD 0912345678 2 thùng matcha')).toMatchObject({ phone: '0912345678', name: '2 thùng matcha' });
    expect(p('LEAD 0912345678')).toMatchObject({ name: 'Khách Zalo', note: null });
  });

  it('reports usage on bad syntax', () => {
    expect(p('LEAD abc')).toMatchObject({ kind: 'INVALID', command: 'LEAD' });
    expect(p('LEAD 12345')).toMatchObject({ kind: 'INVALID', message: expect.stringContaining('Số điện thoại không hợp lệ') });
    expect(p('NHAN')).toMatchObject({ kind: 'INVALID', message: expect.stringContaining('NHAN <mã lead>') });
    expect(p('TRANGTHAI 1234 XYZ')).toMatchObject({ kind: 'INVALID', command: 'TRANGTHAI' });
  });
});

describe('HEN due dates (Vietnam time)', () => {
  it.each([
    ['HEN 1201 16/10 15:00 gửi báo giá matcha', '2026-10-16T15:00:00', 'gửi báo giá matcha'],
    ['hẹn 1201 16/10/2026 9h30 gọi lại', '2026-10-16T09:30:00', 'gọi lại'],
    ['HEN 1201 mai 9h gọi lại', '2026-10-16T09:00:00', 'gọi lại'],
    ['HEN 1201 hôm nay 15:30 gửi mẫu', '2026-10-15T15:30:00', 'gửi mẫu'],
    ['HEN 1201 15h gửi mẫu', '2026-10-15T15:00:00', 'gửi mẫu'],
    ['HEN 1201 8h gửi mẫu', '2026-10-16T08:00:00', 'gửi mẫu'], // already past today → tomorrow
    ['HEN 1201 05/01 10:00 chúc tết', '2027-01-05T10:00:00', 'chúc tết'], // past date this year → next year
    ['HEN 1201 17/10 10:00', '2026-10-17T10:00:00', 'Liên hệ lại khách'],
  ])('%s', (text, due, content) => {
    expect(p(text)).toEqual({ kind: 'HEN', code: 1201, dueAt: vn(due), content });
  });

  it('rejects bad dates', () => {
    expect(p('HEN 1201 31/02 10:00 x')).toMatchObject({ kind: 'INVALID', message: expect.stringContaining('không hợp lệ') });
    expect(p('HEN 1201 16/10 gọi')).toMatchObject({ kind: 'INVALID' });
    expect(p('HEN 1201 gọi lại')).toMatchObject({ kind: 'INVALID', message: expect.stringContaining('Thiếu ngày giờ') });
    expect(p('HEN 1201 25:00 x')).toMatchObject({ kind: 'INVALID' });
  });
});
