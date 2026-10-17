// Channel credentials at rest (SPEC 11.1): JSON encrypted with AES-256-GCM using ENCRYPTION_KEY
// (base64 of 32 bytes). Layout: version(1) | iv(12) | tag(16) | ciphertext.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;

function keyFrom(raw = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be base64 of exactly 32 bytes');
  return key;
}

export function encryptJson(value: unknown, rawKey?: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(rawKey), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const out = Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
}

export function decryptJson<T>(data: Uint8Array, rawKey?: string): T {
  const buf = Buffer.from(data);
  if (buf[0] !== VERSION || buf.length < 29) throw new Error('Unsupported credential format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(rawKey), buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  const text = Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
  return JSON.parse(text) as T;
}
