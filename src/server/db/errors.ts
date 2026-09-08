/**
 * Reading a Postgres error through whatever wrapped it.
 *
 * Drizzle raises its own `DrizzleQueryError` and hangs the driver's error off
 * `cause`, so a check for `error.code === '23505'` on the thing that was thrown
 * quietly never matches. That failure is silent in the worst way: code written to
 * turn a unique violation into a graceful answer instead rethrows, and the path
 * only runs when two requests race — which is not the path anybody exercises by
 * hand.
 *
 * So the cause chain is walked rather than the top-level error inspected.
 */

/** Postgres unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = '23505';

export function isPostgresError(error: unknown, code: string): boolean {
  let current: unknown = error;

  // Bounded, because a cause chain is somebody else's data structure and a cycle
  // in it should not be an infinite loop here.
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

export function isUniqueViolation(error: unknown): boolean {
  return isPostgresError(error, UNIQUE_VIOLATION);
}
