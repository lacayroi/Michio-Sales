import { describe, expect, it } from 'vitest';
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from './session';

const SECRET = 'test-secret-at-least-16-chars';

describe('session token', () => {
  it('round-trips claims', async () => {
    const token = await createSessionToken({ userId: 'u1', orgId: 'o1', role: 'SALES' }, SECRET);
    expect(await verifySessionToken(token, SECRET)).toEqual({ userId: 'u1', orgId: 'o1', role: 'SALES' });
  });

  it('rejects wrong secret, tampering and missing token', async () => {
    const token = await createSessionToken({ userId: 'u1', orgId: 'o1', role: 'SALES' }, SECRET);
    expect(await verifySessionToken(token, 'another-secret-16-chars')).toBeNull();
    expect(await verifySessionToken(`${token.slice(0, -2)}xx`, SECRET)).toBeNull();
    expect(await verifySessionToken(undefined, SECRET)).toBeNull();
  });

  it('expires after 30 days', async () => {
    const issued = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    const token = await createSessionToken({ userId: 'u1', orgId: 'o1', role: 'OWNER' }, SECRET, issued);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('refuses short secrets', async () => {
    await expect(createSessionToken({ userId: 'u', orgId: 'o', role: 'OWNER' }, 'short')).rejects.toThrow();
  });
});
