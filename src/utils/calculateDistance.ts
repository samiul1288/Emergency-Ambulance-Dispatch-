/**
 * Great-circle distance between two geographical coordinates
 * using the Haversine formula.
 *
 * The primary helper returns kilometres; metre / mile variants
 * are provided for convenience.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius in kilometres. */
export const EARTH_RADIUS_KM = 6371.0088;

export const KM_TO_MILES = 0.621371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function assertValidCoordinate(value: Coordinates, label: string): void {
  if (
    typeof value.latitude !== "number" ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude)
  ) {
    throw new RangeError(
      `${label} must contain finite latitude and longitude numbers`,
    );
  }
  if (value.latitude < -90 || value.latitude > 90) {
    throw new RangeError(`${label}.latitude must be between -90 and 90`);
  }
  if (value.longitude < -180 || value.longitude > 180) {
    throw new RangeError(`${label}.longitude must be between -180 and 180`);
  }
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      sinHalfLon *
      sinHalfLon;
  // Clamp for floating-point safety on antipodal points.
  const clamped = Math.min(1, Math.max(0, a));
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

/**
 * Distance between two points in kilometres.
 *
 * @example
 * calculateDistance({ latitude: 23.8103, longitude: 90.4125 }, { latitude: 23.7536, longitude: 90.3882 });
 * calculateDistance(23.8103, 90.4125, 23.7536, 90.3882);
 */
export function calculateDistance(
  from: Coordinates,
  to: Coordinates,
): number;
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number;
export function calculateDistance(
  arg1: Coordinates | number,
  arg2: Coordinates | number,
  arg3?: number,
  arg4?: number,
): number {
  if (
    typeof arg1 === "number" &&
    typeof arg2 === "number" &&
    typeof arg3 === "number" &&
    typeof arg4 === "number"
  ) {
    assertValidCoordinate({ latitude: arg1, longitude: arg2 }, "origin");
    assertValidCoordinate({ latitude: arg3, longitude: arg4 }, "destination");
    return haversineKm(arg1, arg2, arg3, arg4);
  }
  if (typeof arg1 === "object" && typeof arg2 === "object") {
    assertValidCoordinate(arg1, "origin");
    assertValidCoordinate(arg2, "destination");
    return haversineKm(
      arg1.latitude,
      arg1.longitude,
      arg2.latitude,
      arg2.longitude,
    );
  }
  throw new TypeError(
    "calculateDistance expects (from: Coordinates, to: Coordinates) or (lat1, lon1, lat2, lon2)",
  );
}

/** Distance between two points in metres. */
export function calculateDistanceInMeters(
  from: Coordinates,
  to: Coordinates,
): number {
  return calculateDistance(from, to) * 1000;
}

/** Distance between two points in miles. */
export function calculateDistanceInMiles(
  from: Coordinates,
  to: Coordinates,
): number {
  return calculateDistance(from, to) * KM_TO_MILES;
}

