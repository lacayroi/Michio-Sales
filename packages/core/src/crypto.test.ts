import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson } from './crypto';

const KEY = Buffer.alloc(32, 3).toString('base64');

describe('credential encryption (AES-256-GCM)', () => {
  it('round-trips and never stores plaintext', () => {
    const enc = encryptJson({ pageToken: 'EAAB-secret' }, KEY);
    expect(Buffer.from(enc).toString('utf8')).not.toContain('EAAB-secret');
    expect(decryptJson(enc, KEY)).toEqual({ pageToken: 'EAAB-secret' });
    expect(Buffer.compare(Buffer.from(enc), Buffer.from(encryptJson({ pageToken: 'EAAB-secret' }, KEY)))).not.toBe(0); // random IV
  });
  it('rejects tampering, wrong keys and bad key sizes', () => {
    const enc = Buffer.from(encryptJson({ a: 1 }, KEY));
    enc[enc.length - 1]! ^= 1;
    expect(() => decryptJson(enc, KEY)).toThrow();
    expect(() => decryptJson(encryptJson({ a: 1 }, KEY), Buffer.alloc(32, 4).toString('base64'))).toThrow();
    expect(() => encryptJson({}, Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
  });
});
