import { unstable_cache } from 'next/cache';

/**
 * Caching that does not insist on being inside a request.
 *
 * `unstable_cache` needs Next's incremental cache, which exists during a request
 * and nowhere else. Called from anywhere that is not one — an integration test,
 * a seed script, a maintenance command — it throws `Invariant: incrementalCache
 * missing` rather than simply not caching.
 *
 * That matters because the functions worth caching here are not page-only.
 * `createOrder` reads the settings row and the delivery zones, and it is called
 * by the checkout action (a request), by the tests (not a request) and by
 * anything operational somebody writes later (also not a request). Making those
 * services uncacheable to keep the tests running would give up the caching where
 * it counts; making the tests set up a fake request context would mean testing a
 * different code path from the one that ships.
 *
 * So: use the cache when there is one, run the query when there is not. Outside a
 * request there is nothing to share a result with anyway — a script is one
 * caller, once — so "no cache" is not a degraded answer, it is the correct one.
 *
 * The error is matched narrowly and anything else is rethrown. A fallback that
 * swallowed every failure would turn a genuine cache fault into a silent
 * stampede on the database.
 */

function isMissingIncrementalCache(error: unknown): boolean {
  return error instanceof Error && /incrementalCache missing/i.test(error.message);
}

export function cachedRead<T>(
  read: () => Promise<T>,
  keyParts: string[],
  options: { tags: string[]; revalidate: number },
): () => Promise<T> {
  const cached = unstable_cache(read, keyParts, options);

  return async () => {
    try {
      return await cached();
    } catch (error) {
      if (isMissingIncrementalCache(error)) return read();
      throw error;
    }
  };
}
