/**
 * GeoJSON validation utilities for Trackify API.
 *
 * Validates route_geojson payloads:
 *  - Must be valid GeoJSON LineString or MultiLineString
 *  - Coordinates: lat ∈ [-90, 90], lon ∈ [-180, 180]
 *  - Positive altitude validation (if present)
 */

export interface GeoJSONValidationError {
  field: string;
  message: string;
  index?: number;
}

/**
 * Validate a GeoJSON coordinate pair [lon, lat, alt?].
 */
export function validateCoordinate(
  coord: any[],
  idx: number
): GeoJSONValidationError[] {
  const errors: GeoJSONValidationError[] = [];

  if (!Array.isArray(coord) || coord.length < 2) {
    errors.push({
      field: 'route_geojson',
      message: `Coordinate at index ${idx} must be an array of [lon, lat]`,
      index: idx,
    });
    return errors;
  }

  const [lon, lat, alt] = coord;

  if (typeof lon !== 'number' || isNaN(lon)) {
    errors.push({
      field: 'route_geojson',
      message: `Longitude at index ${idx} must be a number, got ${typeof lon}`,
      index: idx,
    });
  } else if (lon < -180 || lon > 180) {
    errors.push({
      field: 'route_geojson',
      message: `Longitude at index ${idx} must be between -180 and 180, got ${lon}`,
      index: idx,
    });
  }

  if (typeof lat !== 'number' || isNaN(lat)) {
    errors.push({
      field: 'route_geojson',
      message: `Latitude at index ${idx} must be a number, got ${typeof lat}`,
      index: idx,
    });
  } else if (lat < -90 || lat > 90) {
    errors.push({
      field: 'route_geojson',
      message: `Latitude at index ${idx} must be between -90 and 90, got ${lat}`,
      index: idx,
    });
  }

  // Optional altitude validation
  if (alt !== undefined && (typeof alt !== 'number' || isNaN(alt))) {
    errors.push({
      field: 'route_geojson',
      message: `Altitude at index ${idx} must be a number if present`,
      index: idx,
    });
  }

  return errors;
}

/**
 * Validate a complete GeoJSON geometry (LineString or MultiLineString).
 *
 * Accepted types:
 *  - LineString: { type: "LineString", coordinates: [[lon, lat], ...] }
 *  - MultiLineString: { type: "MultiLineString", coordinates: [[[lon, lat], ...], ...] }
 */
export function validateGeoJSONGeometry(
  geojson: any
): GeoJSONValidationError[] {
  if (!geojson || typeof geojson !== 'object') {
    return [{ field: 'route_geojson', message: 'Must be a valid GeoJSON object' }];
  }

  const type = geojson.type;

  if (!type || typeof type !== 'string') {
    return [{ field: 'route_geojson', message: 'GeoJSON object must have a "type" property' }];
  }

  if (type !== 'LineString' && type !== 'MultiLineString') {
    return [{
      field: 'route_geojson',
      message: `GeoJSON type must be "LineString" or "MultiLineString", got "${type}"`,
    }];
  }

  const coords = geojson.coordinates;

  if (!Array.isArray(coords) || coords.length === 0) {
    return [{
      field: 'route_geojson',
      message: 'GeoJSON coordinates must be a non-empty array',
    }];
  }

  // Limit to prevent DOS
  const MAX_COORDS = 50000;
  let totalCoords = 0;

  if (type === 'LineString') {
    totalCoords = coords.length;
    if (totalCoords > MAX_COORDS) {
      return [{
        field: 'route_geojson',
        message: `Too many coordinates: ${totalCoords}. Maximum is ${MAX_COORDS}`,
      }];
    }
  } else {
    // MultiLineString
    for (const segment of coords) {
      if (!Array.isArray(segment)) {
        return [{
          field: 'route_geojson',
          message: 'MultiLineString segments must be arrays of coordinates',
        }];
      }
      totalCoords += segment.length;
    }
    if (totalCoords > MAX_COORDS) {
      return [{
        field: 'route_geojson',
        message: `Too many coordinates: ${totalCoords}. Maximum is ${MAX_COORDS}`,
      }];
    }
  }

  // Validate coordinates: sample-based for LineString > 1000 points
  const errors: GeoJSONValidationError[] = [];

  if (type === 'LineString') {
    if (coords.length <= 1000) {
      // Full validation
      for (let i = 0; i < coords.length; i++) {
        errors.push(...validateCoordinate(coords[i], i));
      }
    } else {
      // Sample: validate first 100, last 100, and random spots
      for (let i = 0; i < Math.min(100, coords.length); i++) {
        errors.push(...validateCoordinate(coords[i], i));
      }
      for (let i = Math.max(0, coords.length - 100); i < coords.length; i++) {
        errors.push(...validateCoordinate(coords[i], i));
      }
      // Random sampling for middle
      const sampleSize = 100;
      for (let s = 0; s < sampleSize; s++) {
        const idx = Math.floor(Math.random() * coords.length);
        errors.push(...validateCoordinate(coords[idx], idx));
      }
    }
  } else {
    // MultiLineString: validate first segment fully, sample others
    for (let segIdx = 0; segIdx < coords.length; segIdx++) {
      const segment = coords[segIdx];
      for (let ptIdx = 0; ptIdx < segment.length; ptIdx++) {
        errors.push(...validateCoordinate(segment[ptIdx], ptIdx));
      }
      if (errors.length > 100) break; // Early exit on too many errors
    }
  }

  return errors;
}

/**
 * Extract waypoints from a GeoJSON geometry.
 *
 * @returns Array of { lon, lat, alt?, index }
 */
export function extractWaypoints(
  geojson: any
): { lon: number; lat: number; alt?: number; index: number }[] {
  if (!geojson || !geojson.coordinates) return [];

  const result: { lon: number; lat: number; alt?: number; index: number }[] = [];

  if (geojson.type === 'LineString') {
    geojson.coordinates.forEach((coord: number[], idx: number) => {
      result.push({
        lon: coord[0],
        lat: coord[1],
        alt: coord[2],
        index: idx,
      });
    });
  } else if (geojson.type === 'MultiLineString') {
    let globalIdx = 0;
    for (const segment of geojson.coordinates) {
      segment.forEach((coord: number[]) => {
        result.push({
          lon: coord[0],
          lat: coord[1],
          alt: coord[2],
          index: globalIdx++,
        });
      });
    }
  }

  return result;
}
