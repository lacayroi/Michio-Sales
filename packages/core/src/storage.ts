// File storage (SPEC 4.1): S3-compatible bucket for quote PDFs, inbox attachments and images.
// Files are private; sharing uses signed, expiring links served by the app (SPEC 6.6 "link chia sẻ có
// hạn") so Messenger can fetch attachments without the bucket being public.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface StoredFile {
  body: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
}

export function createS3Storage(cfg = {
  endpoint: process.env.S3_ENDPOINT,
  bucket: process.env.S3_BUCKET ?? 'michio-sales',
  accessKeyId: process.env.S3_ACCESS_KEY ?? '',
  secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  region: process.env.S3_REGION ?? 'us-east-1',
}): ObjectStorage {
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true, // SeaweedFS / MinIO style endpoints
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  let bucketReady: Promise<void> | null = null;
  const ensureBucket = () =>
    (bucketReady ??= s3
      .send(new HeadBucketCommand({ Bucket: cfg.bucket }))
      .then(() => undefined)
      .catch(async () => {
        await s3.send(new CreateBucketCommand({ Bucket: cfg.bucket })).catch(() => undefined);
      }));
  return {
    async put(key, body, contentType) {
      await ensureBucket();
      await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const bytes = await r.Body?.transformToByteArray();
        return bytes ? { body: Buffer.from(bytes), contentType: r.ContentType ?? 'application/octet-stream' } : null;
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
  };
}

/** In-memory storage for tests. */
export function createMemoryStorage(): ObjectStorage & { files: Map<string, StoredFile> } {
  const files = new Map<string, StoredFile>();
  return {
    files,
    async put(key, body, contentType) {
      files.set(key, { body, contentType });
    },
    async get(key) {
      return files.get(key) ?? null;
    },
  };
}

/** `orgs/<org>/<area>/<yyyy-mm>/<uuid>-<safe name>` — unguessable and readable in the bucket. */
export function storageKey(orgId: string, area: 'attachments' | 'quotes' | 'exports', fileName: string, now = new Date()) {
  const safe = fileName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file';
  return `orgs/${orgId}/${area}/${now.toISOString().slice(0, 7)}/${randomUUID()}-${safe}`;
}

function linkSecret() {
  const k = process.env.ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!k) throw new Error('ENCRYPTION_KEY is not set');
  return `file-link:${k}`;
}

const sign = (key: string, exp: number) => createHmac('sha256', linkSecret()).update(`${key}\n${exp}`).digest('base64url');

/** Path of an expiring share link: /api/v1/public/files?k=…&e=…&s=… (prefix with APP_URL for outside use). */
export function signedFilePath(key: string, ttlSeconds: number, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `/api/v1/public/files?${new URLSearchParams({ k: key, e: String(exp), s: sign(key, exp) })}`;
}

export function verifyFileLink(key: string | null, exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!key || !exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  const a = Buffer.from(sign(key, Number(exp)));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
