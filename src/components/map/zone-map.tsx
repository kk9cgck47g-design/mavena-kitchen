'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { CITY_CODES, type CityCode } from '@/lib/domain';
import type { Polygon } from '@/lib/geo';
import { cn } from '@/lib/utils';
import { ZONE_FILL, mapStyle } from './map-style';

export interface MapZone {
  id: string;
  cityCode: CityCode;
  name: string;
  polygon: Polygon;
}

export interface MapCity {
  code: CityCode;
  name: string;
  center: { lat: number; lng: number };
}

/**
 * Delivery zones, one city at a time.
 *
 * Fitting several cities into a single frame looked reasonable in code and
 * failed in practice: two towns tens of kilometres apart fit at around zoom 9,
 * where every zone collapses to a smudge fifteen pixels wide and the map shows
 * empty countryside instead of an answer. Focusing one city keeps the zones at a
 * size where their shape is readable, and the toggle costs one tap.
 *
 * With a single city there is nothing to toggle, and the control below hides
 * itself rather than offering a choice of one.
 *
 * MapLibre is imported dynamically inside the effect: it is a large dependency
 * and has no business in the bundle of pages without a map.
 */
export function ZoneMap({
  zones,
  cities,
  restaurant,
  twoFingerHint,
}: {
  zones: MapZone[];
  cities: MapCity[];
  restaurant: { lat: number; lng: number };
  /** Shown over the map when a single finger tries to pan it. */
  twoFingerHint: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // The fallback comes from the vocabulary rather than a literal, so it cannot
  // name a city that has stopped existing.
  const [activeCity, setActiveCity] = useState<CityCode>(cities[0]?.code ?? CITY_CODES[0]);

  // Build the map once. City changes only move the camera — tearing the map
  // down and back up would refetch every tile for a pan.
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      const maplibre = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');

      if (cancelled || !containerRef.current) return;

      // Serve the worker ourselves — see scripts/copy-maplibre-worker.mjs.
      // Without this the map renders raster tiles but silently never parses a
      // vector source, so the zone polygons never appear.
      maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

      /*
        On a touchscreen the map is a scroll trap. It sets `touch-action: none`
        on its canvas and claims one-finger drags for panning, so a 350 px tall
        map in the middle of a scrolling page simply stops the page: the finger
        lands on it and nothing moves. Cooperative gestures hand single-finger
        drags back to the page and ask for two fingers to move the map, which
        is the behaviour people already know from embedded maps everywhere.

        Only on touch. With a mouse there is no ambiguity to resolve — a drag is
        unmistakably aimed at the map — and turning it on would mean desktop
        visitors had to hold a modifier key to zoom, which nothing here asks for.
      */
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: mapStyle(),
        center: [restaurant.lng, restaurant.lat],
        zoom: 12,
        attributionControl: { compact: true },
        cooperativeGestures: coarsePointer,
        locale: { 'CooperativeGesturesHandler.MobileHelpText': twoFingerHint },
      });

      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

      map.on('load', () => {
        if (zones.length === 0) return;

        map.addSource('zones', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: zones.map((zone) => ({
              type: 'Feature',
              geometry: zone.polygon,
              properties: { name: zone.name, city: zone.cityCode },
            })),
          },
        });

        map.addLayer({
          id: 'zones-fill',
          type: 'fill',
          source: 'zones',
          paint: { 'fill-color': ZONE_FILL, 'fill-opacity': 0.2 },
        });

        map.addLayer({
          id: 'zones-outline',
          type: 'line',
          source: 'zones',
          paint: { 'line-color': ZONE_FILL, 'line-width': 2.5, 'line-opacity': 0.95 },
        });

        new maplibre.Marker({ color: ZONE_FILL })
          .setLngLat([restaurant.lng, restaurant.lat])
          .addTo(map);

        fitCity(map, maplibre.LngLatBounds, zones, activeCity, false);
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Intentionally built once: `activeCity` is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, restaurant.lat, restaurant.lng, twoFingerHint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    (async () => {
      const { LngLatBounds } = await import('maplibre-gl');
      if (!cancelled && mapRef.current) fitCity(mapRef.current, LngLatBounds, zones, activeCity, true);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCity, zones]);

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" aria-label="Delivery zones map" />

      {cities.length > 1 && (
        <div className="absolute top-3 left-3 flex gap-1.5 rounded-full border border-white/10 bg-[color-mix(in_oklab,var(--color-coal-1000)_78%,transparent)] p-1 backdrop-blur-md">
          {cities.map((city) => (
            <button
              key={city.code}
              type="button"
              onClick={() => setActiveCity(city.code)}
              aria-pressed={city.code === activeCity}
              className={cn(
                'relative rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
                // The pills float over the map and have to stay small; the tap
                // target does not, so it is grown with a transparent overlay.
                'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                // Lime marks the selected city here, so focus is shown in white.
                'focus-visible:outline-coal-50 focus-visible:outline-2 focus-visible:outline-offset-2',
                city.code === activeCity
                  ? 'bg-lime-500 text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {city.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type BoundsCtor = new () => {
  extend: (coord: [number, number]) => unknown;
  isEmpty: () => boolean;
};

function fitCity(
  map: MapLibreMap,
  Bounds: BoundsCtor,
  zones: MapZone[],
  cityCode: CityCode,
  animate: boolean,
) {
  const cityZones = zones.filter((zone) => zone.cityCode === cityCode);
  if (cityZones.length === 0) return;

  const bounds = new Bounds();
  for (const zone of cityZones) {
    for (const [lng, lat] of zone.polygon.coordinates[0]) bounds.extend([lng, lat]);
  }
  if (bounds.isEmpty()) return;

  map.fitBounds(bounds as never, {
    padding: 40,
    duration: animate ? 700 : 0,
    maxZoom: 14,
  });
}
