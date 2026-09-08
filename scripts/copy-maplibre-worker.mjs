import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Copy MapLibre's worker bundle into `public/maplibre/`.
 *
 * MapLibre boots its worker with `new Worker(new URL('./maplibre-gl-worker.mjs',
 * import.meta.url), { type: 'module' })`. Under Turbopack that URL resolves to a
 * path inside node_modules that is never served, so the worker silently fails to
 * start. The map still looks alive — raster tiles load on the main thread — but
 * every vector source stays unparsed: `isStyleLoaded()` never turns true and no
 * fill or line layer ever renders. It fails quietly, with no console error, which
 * is what makes it worth this much explanation.
 *
 * Serving the worker ourselves and pointing `setWorkerUrl` at it fixes that.
 * `maplibre-gl-shared.mjs` comes along because the worker imports it as a
 * sibling.
 *
 * Runs on postinstall so an upgrade cannot leave a stale worker behind.
 */

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
const target = path.join(process.cwd(), 'public', 'maplibre');

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

await mkdir(target, { recursive: true });

for (const file of FILES) {
  await copyFile(path.join(dist, file), path.join(target, file));
}

console.log(`maplibre: copied ${FILES.length} worker files to public/maplibre/`);
