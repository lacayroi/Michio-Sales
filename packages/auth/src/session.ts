// Stateless signed session cookie. Edge-safe (used by Next.js middleware).
// Revocation (deactivated user, role change) is enforced by re-loading the user from DB per request.
import { jwtVerify, SignJWT } from 'jose';
import type { Role } from './permissions';

export const SESSION_COOKIE = 'msh_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // SPEC 6.1: phiên giữ 30 ngày

export interface SessionClaims {
  userId: string;
  orgId: string;
  role: Role;
}

function key(secret: string): Uint8Array {
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET must be at least 16 characters');
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(claims: SessionClaims, secret: string, now = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ orgId: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_MAX_AGE_SECONDS)
    .sign(key(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.orgId !== 'string' || typeof payload.role !== 'string') return null;
    return { userId: payload.sub, orgId: payload.orgId, role: payload.role as Role };
  } catch {
    return null;
  }
}
