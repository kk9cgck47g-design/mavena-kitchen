import type { StyleSpecification } from 'maplibre-gl';

/**
 * Map style.
 *
 * No Google Maps here, and no geocoding anywhere in this project. The courier
 * does not need a parsed address — they need coordinates and a landmark. That
 * removes the only reason to pay for a mapping platform, so MapLibre with
 * OpenStreetMap tiles does the job for nothing and needs no billing account.
 *
 * MapTiler is used when a key is configured, because its vector tiles are
 * sharper and it allows a dark style that matches the interface. Without a key
 * the map falls back to raw OSM raster tiles, which are lighter in colour but
 * entirely functional — the site never breaks because an integration is missing.
 *
 * **The fallback is for development and for a preview, not for a live shop.**
 * `tile.openstreetmap.org` is a donation-funded service, and the OSM Foundation's
 * Tile Usage Policy does not cover a commercial site serving customers from it.
 * Nothing in the code can make that permission exist, so what the code can do is
 * say so at the point where the choice is made: a deployment that takes real
 * orders needs its own key, and the README's "set exactly one environment
 * variable" applies to the design preview only.
 *
 * The key itself is public on purpose and must stay `NEXT_PUBLIC_`. MapLibre
 * fetches tiles straight from the browser, so the key travels there no matter
 * where it is stored; MapTiler issues these as browser keys for exactly that.
 * Hiding it would mean proxying every tile through this server — more latency
 * and more bandwidth for no gain. What protects the quota is an allowed-origins
 * restriction on the key in the MapTiler dashboard, which is account
 * configuration and cannot be expressed here.
 */

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

export function hasVectorTiles(): boolean {
  return Boolean(MAPTILER_KEY);
}

export function mapStyle(): string | StyleSpecification {
  if (MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`;
  }

  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#12110f' } },
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-saturation': -0.6,
          'raster-brightness-max': 0.6,
          'raster-contrast': 0.15,
        },
      },
      {
        /**
         * A dark wash over the tiles.
         *
         * The raster paint properties alone leave OSM's default style far too
         * bright to sit in this interface — a pale grey-green rectangle punched
         * through a near-black page. Layering a translucent dark fill on top is
         * deterministic, needs no custom tile server, and keeps the lime zone
         * outlines legible because they are drawn above it at runtime.
         *
         * Measured against the page rather than guessed at: at 0.55 the map was
         * still the brightest thing on the checkout screen. It is not meant to
         * disappear — a pin is dropped on it, so streets have to stay readable —
         * only to stop being the outlier.
         */
        id: 'basemap-dim',
        type: 'background',
        paint: { 'background-color': '#0A0A09', 'background-opacity': 0.68 },
      },
    ],
  } satisfies StyleSpecification;
}

/** Lime, matched to the interface accent. */
export const ZONE_FILL = '#8fd14f';
