'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, LocateFixed, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import { ZONE_FILL, mapStyle } from '@/components/map/map-style';
import { prefersReducedMotion } from '@/hooks/use-media-query';
import type { CityCode } from '@/lib/domain';
import type { LatLng, Polygon } from '@/lib/geo';
import { cn } from '@/lib/utils';

/**
 * Where to deliver.
 *
 * The pin does not move — the map does, under a crosshair fixed to the centre of
 * the frame. A draggable marker is the obvious design and the wrong one on a
 * phone: the finger placing it covers the thing being placed, and hitting a
 * 30-pixel target on a moving map is fiddly in a way that dragging a whole map
 * under a fixed point is not. It also means there is always exactly one answer
 * to "where is the pin", which removes a class of state bugs entirely.
 *
 * The customer's coordinates come from `moveend` — when the map has actually
 * stopped, not on every frame of a pan.
 *
 * MapLibre is imported inside the effect: it is a large dependency, and the
 * pickup half of this same screen must not pay for it.
 */

export interface PinMapZone {
  id: string;
  cityCode: CityCode;
  name: string;
  polygon: Polygon;
}

export interface PinMapCity {
  code: CityCode;
  name: string;
  center: LatLng;
  defaultZoom: number;
}

/** Close enough to a house that the courier does not have to guess which one. */
const PIN_ZOOM = 16;

export function PinMap({
  city,
  zones,
  initialPoint,
  onChange,
  inside,
}: {
  city: PinMapCity;
  /** Every active zone; the map shows the ones belonging to `city`. */
  zones: PinMapZone[];
  /** Read once, on mount. After that the map owns the camera — see the effect below. */
  initialPoint: LatLng | null;
  onChange: (point: LatLng) => void;
  /**
   * Whether the pin currently sits in a delivery zone, decided on the client for
   * instant feedback. It colours the pin and nothing else — no amount on this
   * screen is ever derived from it.
   */
  inside: boolean | null;
}) {
  const t = useTranslations('checkout');
  const tmap = useTranslations('map');

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  /**
   * True once the map exists *and* its `zones` source has been added.
   *
   * The zone effect below used to read `mapRef.current` directly, and on the
   * first pass it was always `null`: the map is built inside
   * `await import('maplibre-gl')`, so it does not exist yet when the effects run.
   * That effect then bailed and never ran again — neither `zones` nor
   * `city.code` changes on their own — and the delivery area was simply never
   * drawn. It appeared only if the customer switched city and came back, which
   * is why the contacts map (which adds its zones inside `on('load')`) looked
   * correct while this one did not.
   *
   * Reset in the cleanup so a remount — React's development double-invoke, or a
   * city change that rebuilds nothing — cannot leave this `true` while a fresh
   * map is still loading.
   */
  const [mapReady, setMapReady] = useState(false);

  /**
   * Held in refs so the map is built once and never rebuilt.
   *
   * `onChange` especially: it is a new function on every render of the parent,
   * and listing it as a dependency would tear the map down and reload every tile
   * each time the customer typed a character into the address field.
   */
  const onChangeRef = useRef(onChange);
  const initialPointRef = useRef(initialPoint);

  // Assigned after render rather than during it. The ref is seeded with the
  // first `onChange`, so the map's own listeners can never find it empty.
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const flyTo = useCallback((point: LatLng, zoom?: number) => {
    mapRef.current?.flyTo({
      center: [point.lng, point.lat],
      zoom: zoom ?? PIN_ZOOM,
      duration: prefersReducedMotion() ? 0 : 700,
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      const maplibre = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');

      if (cancelled || !containerRef.current) return;

      // Served locally — see scripts/copy-maplibre-worker.mjs. Without it the
      // raster tiles draw but no vector source is ever parsed.
      maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

      /*
        Cooperative gestures on touch, exactly as on the contacts map. A map that
        claims one-finger drags is a scroll trap: the finger lands on it halfway
        down a form and the page simply stops moving. Two fingers to pan is the
        behaviour embedded maps have taught everyone, and it costs less than a
        checkout the customer cannot scroll past.
      */
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      const start = initialPointRef.current;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: mapStyle(),
        center: start ? [start.lng, start.lat] : [city.center.lng, city.center.lat],
        zoom: start ? PIN_ZOOM : city.defaultZoom,
        attributionControl: { compact: true },
        cooperativeGestures: coarsePointer,
        locale: { 'CooperativeGesturesHandler.MobileHelpText': tmap('twoFingerHint') },
      });

      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

      map.on('load', () => {
        if (cancelled) return;

        map.addSource('zones', { type: 'geojson', data: emptyCollection() });

        // Matched to the contacts map on purpose: the same delivery area drawn
        // two visibly different weights on two screens reads as two different
        // pieces of information.
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

        // The camera is already where it belongs, but nothing has told the form
        // that yet. Reporting it here means the quote resolves on arrival
        // instead of waiting for the customer to nudge the map first.
        const center = map.getCenter();
        onChangeRef.current({ lat: center.lat, lng: center.lng });

        // Last, so the zone effect can assume the source is there to be fed.
        setMapReady(true);
      });

      map.on('moveend', () => {
        const center = map.getCenter();
        onChangeRef.current({ lat: center.lat, lng: center.lng });
      });
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Built once. The city is handled by the effect below, and the zone data by
    // the one after it; `city` is read from the closure only for the first camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Zone polygons for the selected city, refreshed without rebuilding the map.
   *
   * Gated on `mapReady` rather than on `mapRef.current`, which is what makes it
   * run at all: the ref is still empty on the first pass, and re-reading it
   * later needs something in the dependency list that actually changes.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    // Typed explicitly: `getSource` is generic over every source kind, and
    // only a GeoJSON one can be re-fed without rebuilding the layer.
    const source = map.getSource<GeoJSONSource>('zones');
    if (!source) return;

    source.setData({
      type: 'FeatureCollection',
      features: zones
        .filter((zone) => zone.cityCode === city.code)
        .map((zone) => ({
          type: 'Feature' as const,
          geometry: zone.polygon,
          properties: { name: zone.name },
        })),
    });
  }, [zones, city.code, mapReady]);

  /**
   * Follow a change of city.
   *
   * Skipped on the first run: the map was just built at the right place, and
   * flying it there again would fight the restored pin.
   */
  const previousCity = useRef<CityCode | null>(null);
  useEffect(() => {
    const previous = previousCity.current;
    previousCity.current = city.code;
    if (previous === null || previous === city.code) return;

    setLocateError(null);
    flyTo(city.center, city.defaultZoom);
  }, [city.code, city.center, city.defaultZoom, flyTo]);

  /**
   * Ask the device where it is — only ever from this button.
   *
   * Never on mount: a page that reaches for someone's location the moment it
   * loads earns a permission prompt nobody asked for, and a refusal that then
   * sticks for the whole origin.
   */
  function locate() {
    if (!('geolocation' in navigator)) {
      setLocateError(t('locationUnsupported'));
      return;
    }

    setLocateError(null);
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        flyTo({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      (error) => {
        setLocating(false);
        // A refusal is a choice, not a fault, and is worded as one. Everything
        // else — no signal, timeout — is the same message: the map still works,
        // it just has to be moved by hand.
        setLocateError(
          error.code === error.PERMISSION_DENIED
            ? t('locationDenied')
            : t('locationUnavailable'),
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'relative h-64 overflow-hidden rounded-2xl border transition-colors sm:h-80',
          inside === false ? 'border-destructive/50' : 'border-white/8',
        )}
      >
        <div ref={containerRef} className="size-full" aria-label={t('mapHint')} />

        {/*
          The pin, drawn over the centre of the frame rather than added to the
          map as a marker: it is the viewfinder, not a thing on the map, so it
          must not move when the map does. `pointer-events-none` keeps it from
          swallowing the drag it exists to describe.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="-translate-y-3">
            <span
              className={cn(
                'block size-4 rounded-full border-[3px] shadow-lg transition-colors',
                inside === false
                  ? 'border-destructive bg-destructive/30'
                  : 'border-lime-400 bg-lime-400/30',
              )}
            />
            <span
              className={cn(
                'mx-auto block h-3 w-0.5 transition-colors',
                inside === false ? 'bg-destructive' : 'bg-lime-400',
              )}
            />
          </span>
        </div>

      </div>

      {/*
        Below the map rather than floating over it.
        Overlaid, they collided with two things that also insist on the corners:
        MapLibre's zoom control top-right and the OpenStreetMap attribution
        bottom-right, which on a 390px phone is wide enough to bury the second
        button completely. Attribution is not negotiable and the labels are three
        words long in three languages, so the controls moved instead.
      */}
      <div className="flex flex-wrap gap-2">
        <MapButton onClick={() => flyTo(city.center, city.defaultZoom)}>
          <Crosshair className="size-4" />
          {t('mapReset')}
        </MapButton>

        <MapButton onClick={locate} disabled={locating}>
          {locating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LocateFixed className="size-4" />
          )}
          {t('myLocation')}
        </MapButton>
      </div>

      <p className="text-muted-foreground text-xs">{t('mapHint')}</p>

      {/* Polite, not assertive: losing the location race is not an emergency. */}
      <p aria-live="polite" className="text-destructive text-xs empty:hidden">
        {locateError}
      </p>
    </div>
  );
}

function MapButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'bg-elevated flex min-h-11 items-center gap-1.5 rounded-full border border-white/8 px-4 text-xs font-semibold transition-colors',
        'hover:border-white/16 disabled:opacity-50',
      )}
    >
      {children}
    </button>
  );
}

function emptyCollection() {
  return { type: 'FeatureCollection' as const, features: [] };
}
