import { prisma } from '@michio/db';
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { ApiKeys } from './api-keys';

export const metadata = { title: 'API key website' };

export default async function ApiKeysPage() {
  const user = await requireUser('integration.manage');
  const keys = await prisma.apiKey.findMany({ where: { orgId: user.orgId }, orderBy: { id: 'desc' } });
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return (
    <section className="max-w-2xl">
      <Link href="/cai-dat" className="text-sm text-muted-foreground hover:underline">← Cài đặt</Link>
      <h1 className="mb-1 mt-1 text-2xl font-semibold">API key website</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Form WordPress gửi lead tới <code className="rounded bg-muted px-1">{base}/api/v1/public/leads</code> kèm header <code className="rounded bg-muted px-1">X-Api-Key</code>. Hướng dẫn cài đặt có trong <code className="rounded bg-muted px-1">docs/wordpress-snippet.md</code>.
      </p>
      <ApiKeys keys={keys.map((k) => ({ id: k.id, name: k.name, source: k.source, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revoked: !!k.revokedAt }))} />
    </section>
  );
}
