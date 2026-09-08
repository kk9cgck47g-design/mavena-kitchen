import { z } from 'zod';

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type LatLng = z.infer<typeof latLngSchema>;

/**
 * A GeoJSON Polygon ring: `[[lng, lat], ...]`, first and last point equal.
 * Note the GeoJSON axis order — longitude first. Getting this backwards is the
 * single most common bug when working with map data, so every conversion to and
 * from `LatLng` goes through the helpers below.
 */
export const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1),
});

export type Polygon = z.infer<typeof polygonSchema>;

export function toGeoJsonPosition({ lat, lng }: LatLng): [number, number] {
  return [lng, lat];
}

export function fromGeoJsonPosition([lng, lat]: [number, number]): LatLng {
  return { lat, lng };
}

/**
 * Ray casting point-in-polygon test, run on the server to decide whether an
 * address falls inside a delivery zone.
 *
 * Only the outer ring is considered — delivery zones are simple areas, and we
 * deliberately do not support holes: a zone with a hole is almost always a
 * mistake in the admin panel rather than an intent.
 *
 * At city scale (a few km) treating lat/lng as a plane is accurate to well
 * under a metre, so no projection is needed.
 */
export function isPointInPolygon(point: LatLng, polygon: Polygon): boolean {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return false;

  const { lat, lng } = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];

    const straddlesRay = latI > lat !== latJ > lat;
    if (!straddlesRay) continue;

    const intersectionLng = ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (lng < intersectionLng) inside = !inside;
  }

  return inside;
}

/** Deep link that opens the exact drop-off point in the courier's preferred map app. */
export function googleMapsLink({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function yandexMapsLink({ lat, lng }: LatLng): string {
  return `https://yandex.com/maps/?pt=${lng},${lat}&z=18&l=map`;
}
