import { SESSION_COOKIE } from '@michio/auth';
import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

/** Used when a still-signed cookie belongs to a user that is no longer allowed in (deactivated). */
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
