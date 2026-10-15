import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api';
import { navFor } from '@/lib/nav';

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const { deletedAt: _deletedAt, ...me } = user;
  return NextResponse.json({ user: me, menu: navFor(user.role).map(({ href, label }) => ({ href, label })) });
}
