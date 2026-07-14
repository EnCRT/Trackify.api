/**
 * Douglas-Peucker line simplification algorithm.
 *
 * Reduces the number of points in a polyline while preserving its
 * overall shape. Used for rendering tracks at lower zoom levels
 * to reduce payload size without visible quality loss.
 *
 * Performance: O(n log n) average, O(n²) worst case.
 * For 10K points, typical runtime < 50ms.
 */

export interface Point {
  lon: number;
  lat: number;
}

/**
 * Perpendicular distance from point `p` to line segment `a → b`.
 * Returns distance in degrees (WGS84). For short segments (< 100 km)
 * this approximates true geographic distance well enough.
 */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;

  // Segment length squared
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a point — return distance to that point
    const ddx = p.lon - a.lon;
    const ddy = p.lat - a.lat;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  // Project point onto line, clamp to [0, 1]
  const t = Math.max(0, Math.min(1,
    ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / lenSq
  ));

  const projLon = a.lon + t * dx;
  const projLat = a.lat + t * dy;

  const distX = p.lon - projLon;
  const distY = p.lat - projLat;

  return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Recursive Douglas-Peucker simplification.
 *
 * @param points   — array of {lon, lat}
 * @param tolerance — maximum allowed deviation (in coordinate units of WGS84 degrees)
 * @returns simplified array of {lon, lat}
 */
function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) {
    return points;
  }

  // Find point with maximum distance from the line segment
  let maxDist = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance exceeds tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);

    // Concat, avoiding duplicate middle point
    return left.slice(0, -1).concat(right);
  }

  // All points within tolerance — keep only endpoints
  return [first, last];
}

/**
 * Simplify a GeoJSON LineString geometry using Douglas-Peucker.
 *
 * @param geojson     — GeoJSON LineString: { type: "LineString", coordinates: [[lon, lat], ...] }
 * @param tolerance   — maximum deviation in WGS84 degrees
 *                      (~0.00001 ≈ 1m, ~0.0001 ≈ 11m, ~0.001 ≈ 111m, ~0.01 ≈ 1.1km)
 * @returns simplified GeoJSON LineString
 */
export function simplifyGeoJSON(
  geojson: { type: string; coordinates: number[][] },
  tolerance: number
): { type: string; coordinates: number[][] } {
  if (!geojson || geojson.type !== 'LineString' || !geojson.coordinates) {
    return geojson;
  }

  const points: Point[] = geojson.coordinates.map(([lon, lat]) => ({ lon, lat }));
  const simplified = douglasPeucker(points, tolerance);

  return {
    type: 'LineString',
    coordinates: simplified.map((p) => [p.lon, p.lat]),
  };
}

/**
 * Tolerance recommendations by zoom level (approximate, WGS84 degrees).
 *
 * Zoom 1-3:   0.5   — continent-level, ~55 km tolerance
 * Zoom 4-6:   0.05  — region-level,  ~5.5 km tolerance
 * Zoom 7-9:   0.005 — city-level,     ~550 m tolerance
 * Zoom 10-12: 0.001 — district-level, ~111 m tolerance
 * Zoom 13+:   0.0001 — street-level,  ~11 m tolerance
 */
export const ZOOM_TOLERANCES: Record<number, number> = {
  1: 0.5,
  2: 0.5,
  3: 0.5,
  4: 0.05,
  5: 0.05,
  6: 0.05,
  7: 0.005,
  8: 0.005,
  9: 0.005,
  10: 0.001,
  11: 0.001,
  12: 0.001,
  13: 0.0001,
};

/**
 * Get recommended tolerance for a zoom level.
 */
export function toleranceForZoom(zoom: number): number {
  // Clamp zoom to known range
  const z = Math.max(1, Math.min(20, Math.round(zoom)));
  // Find the closest defined zoom level
  const defined = Object.keys(ZOOM_TOLERANCES).map(Number).sort((a, b) => a - b);
  for (const d of defined) {
    if (z <= d) return ZOOM_TOLERANCES[d];
  }
  return ZOOM_TOLERANCES[13]; // fallback
}
