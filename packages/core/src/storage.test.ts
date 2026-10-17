import { describe, expect, it } from 'vitest';
import { signedFilePath, storageKey, verifyFileLink } from './storage';

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString('base64');

describe('signed file links', () => {
  it('verifies until expiry and rejects tampering', () => {
    const now = Date.UTC(2026, 9, 17, 3);
    const q = new URLSearchParams(signedFilePath('orgs/o/quotes/x.pdf', 3600, now).split('?')[1]);
    expect(verifyFileLink(q.get('k'), q.get('e'), q.get('s'), now + 3599_000)).toBe(true);
    expect(verifyFileLink(q.get('k'), q.get('e'), q.get('s'), now + 3601_000)).toBe(false);
    expect(verifyFileLink('orgs/o/quotes/y.pdf', q.get('e'), q.get('s'), now)).toBe(false);
    expect(verifyFileLink(q.get('k'), String(Number(q.get('e')) + 100), q.get('s'), now)).toBe(false);
    expect(verifyFileLink(q.get('k'), q.get('e'), null, now)).toBe(false);
  });
  it('builds safe keys from Vietnamese file names', () => {
    expect(storageKey('o1', 'quotes', 'Báo giá Shop Hoa.pdf', new Date('2026-10-17T00:00:00Z'))).toMatch(/^orgs\/o1\/quotes\/2026-10\/[0-9a-f-]{36}-Bao-gia-Shop-Hoa\.pdf$/);
  });
});
