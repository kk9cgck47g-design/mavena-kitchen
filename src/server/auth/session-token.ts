import { env } from '@/lib/env';

/**
 * A signed, stateless session token.
 *
 * Written out rather than pulled from an auth library, and that is a scoped
 * decision rather than a preference: this system has a handful of staff
 * accounts created by the owner, no public sign-up, no OAuth providers, no
 * password reset flow and no third-party identity to federate with. What it
 * needs is "prove this browser presented the right password recently", which is
 * an HMAC over a user id and an expiry. A library would bring adapters,
 * providers and a database schema for none of it.
 *
 * Revocable, without a session table. The token carries when it was issued, and
 * `admin_users.sessionsValidFrom` says how far back this account's tokens are
 * still honoured; `currentAdmin` compares the two on a row it was already
 * reading. Moving that column invalidates every token the person holds, which is
 * what "sign out everywhere", a changed password and a deactivated account all
 * need. What it cannot do is revoke one device and leave another — that would
 * want a row per session, and for a handful of staff it is not worth the table.
 *
 * Not a JWT. No algorithm field, so there is no algorithm to confuse it about —
 * the one signature scheme is compiled in.
 *
 * The secret is `AUTH_SECRET`, from the environment. Without it the admin panel
 * refuses to serve at all rather than falling back to something weaker.
 */

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

/** Eight hours: long enough for a shift, short enough that a forgotten tab expires. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface SessionPayload {
  /** Admin user id. */
  sub: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
  /**
   * Issued at, epoch milliseconds.
   *
   * Compared against `sessionsValidFrom` on the account. Required, not optional:
   * a token without one cannot be shown to have been issued after the last
   * revocation, and the safe reading of "cannot be shown" is "refuse". The cost
   * is that sessions issued before this field existed stop working, which is a
   * one-off sign-in and the correct direction to fail in.
   */
  iat: number;
}

/** What a valid token says. */
export interface SessionClaims {
  userId: string;
  issuedAt: number;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Copied into a fresh `ArrayBuffer` rather than handed over as a view onto
 * Node's pooled one: `Buffer` slices share a backing store, and `crypto.subtle`
 * wants a buffer it can rely on being exactly the bytes it was given.
 */
function fromBase64Url(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, 'base64url');
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALGORITHM, false, [
    'sign',
    'verify',
  ]);
}

export function authSecret(): string | null {
  return env.AUTH_SECRET ?? null;
}

export async function signSession(userId: string, now = Date.now()): Promise<string> {
  const secret = authSecret();
  if (!secret) throw new Error('AUTH_SECRET is not set — refusing to issue a session.');

  const payload: SessionPayload = { sub: userId, exp: now + SESSION_TTL_MS, iat: now };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    ALGORITHM,
    await key(secret),
    new TextEncoder().encode(body),
  );

  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * What a token claims, or null.
 *
 * Verifies the signature before it parses anything, and uses `crypto.subtle.verify`
 * rather than comparing strings, so the check does not leak how much of a
 * forged signature was right by how long it took to reject.
 *
 * Says nothing about whether the account still exists, is still active, or has
 * revoked its sessions since. That is `currentAdmin`'s job, and it needs the
 * database to answer it.
 */
export async function verifySession(
  token: string,
  now = Date.now(),
): Promise<SessionClaims | null> {
  const secret = authSecret();
  if (!secret) return null;

  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      ALGORITHM,
      await key(secret),
      fromBase64Url(signature),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }

  if (!valid) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(new Uint8Array(fromBase64Url(body))),
    ) as SessionPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (typeof payload.iat !== 'number') return null;
    if (payload.exp <= now) return null;
    return { userId: payload.sub, issuedAt: payload.iat };
  } catch {
    return null;
  }
}
