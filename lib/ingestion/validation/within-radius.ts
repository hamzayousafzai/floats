import type { IngestionConfig } from "@/lib/ingestion/config";

const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_PER_MILE = 1609.344;

export type RadiusConfig = Pick<IngestionConfig, "centerLat" | "centerLng" | "radiusMiles">;

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    // (0, 0) is the conventional "geocoder gave up" value, never a Charlotte-area venue.
    !(latitude === 0 && longitude === 0)
  );
}

/** Great-circle (haversine) distance on a sphere; within roughly 0.5% of the geodesic distance PostGIS computes. */
export function distanceMeters(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Pre-filter only. PostGIS `ST_DWithin` on geography remains authoritative at publication, so points within the
 * spherical-versus-spheroid tolerance of the boundary may still be rejected by the database.
 * Invalid coordinates are never within the radius.
 */
export function isWithinRadius(latitude: number, longitude: number, config: RadiusConfig): boolean {
  if (!isValidCoordinate(latitude, longitude)) return false;
  return distanceMeters(config.centerLat, config.centerLng, latitude, longitude) <= config.radiusMiles * METERS_PER_MILE;
}
