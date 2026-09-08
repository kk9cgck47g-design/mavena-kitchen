import { describe, expect, it } from 'vitest';

import { signSession, verifySession, SESSION_TTL_MS } from '@/server/auth/session-token';
import { parseOrderSearch } from '@/server/services/admin-orders';

/**
 * The session token is the whole of the admin panel's front door, so the
 * interesting cases are the ones where it must say no.
 *
 * Requires `AUTH_SECRET` in `.env.local`, which `tests/setup-env.ts` loads.
 */
describe('session token', () => {
  const userId = '9f1c6b2a-9d2f-4b7e-9d1a-5f0f9c4e2a11';

  it('round-trips the user it was issued for, and when', async () => {
    const issued = Date.now();
    const token = await signSession(userId, issued);

    // The issue time is not decoration: `currentAdmin` compares it against the
    // account's `sessionsValidFrom`, which is the whole of session revocation.
    expect(await verifySession(token)).toEqual({ userId, issuedAt: issued });
  });

  it('rejects a token whose payload was edited', async () => {
    const token = await signSession(userId);
    const [body, signature] = token.split('.');

    // Re-encode a payload claiming to be somebody else, keeping the signature.
    const forged = Buffer.from(
      JSON.stringify({ sub: 'someone-else', exp: Date.now() + SESSION_TTL_MS, iat: Date.now() }),
    ).toString('base64url');

    expect(await verifySession(`${forged}.${signature}`)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it('rejects a validly signed token that predates the issue-time claim', async () => {
    /*
      A token from before revocation existed. Its signature is genuine, so the
      only thing distinguishing it is the missing `iat` — and without one there
      is no way to show it was issued after the account's last revocation. The
      safe reading of "cannot be shown" is "refuse", at the cost of one sign-in.
    */
    const body = Buffer.from(
      JSON.stringify({ sub: userId, exp: Date.now() + SESSION_TTL_MS }),
    ).toString('base64url');

    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', process.env.AUTH_SECRET ?? '')
      .update(body)
      .digest('base64url');

    expect(await verifySession(`${body}.${signature}`)).toBeNull();
  });

  it('rejects a token whose signature was edited', async () => {
    const [body] = (await signSession(userId)).split('.');
    const bogus = Buffer.from('not a signature').toString('base64url');

    expect(await verifySession(`${body}.${bogus}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const issued = Date.now() - SESSION_TTL_MS * 2;
    const token = await signSession(userId, issued);

    expect(await verifySession(token, issued)).toEqual({ userId, issuedAt: issued });
    expect(await verifySession(token)).toBeNull();
  });

  it('rejects nonsense rather than throwing', async () => {
    expect(await verifySession('')).toBeNull();
    expect(await verifySession('no-dot')).toBeNull();
    expect(await verifySession('a.b.c')).toBeNull();
  });
});

describe('parseOrderSearch', () => {
  it('recognises an order code however it was typed', () => {
    expect(parseOrderSearch('MK-482193')).toEqual({ code: 'MK-482193' });
    expect(parseOrderSearch('482193')).toEqual({ code: 'MK-482193' });
    expect(parseOrderSearch('mk 482193')).toEqual({ code: 'MK-482193' });
  });

  it('normalises a phone number so any spelling of it finds the order', () => {
    expect(parseOrderSearch('+37493123456')).toEqual({ phone: '+37493123456' });
    expect(parseOrderSearch('093 12 34 56')).toEqual({ phone: '+37493123456' });
  });

  it('returns nothing for input that is neither', () => {
    // The caller turns this into "no results" rather than "no filter", so that
    // a typo cannot quietly list every customer in the database.
    expect(parseOrderSearch('ab')).toBeNull();
    expect(parseOrderSearch('   ')).toBeNull();
  });
});
