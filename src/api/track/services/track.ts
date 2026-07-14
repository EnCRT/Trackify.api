/**
 * track service — core CRUD + spatial query helpers
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::track.track', ({ strapi }) => ({
  /**
   * Simplify a single track's route_geojson using PostGIS.
   *
   * @returns the track with simplified route_geojson, or null if not found / no route.
   */
  async simplifyTrack(
    trackId: string | number,
    tolerance: number
  ): Promise<any | null> {
    const knex = strapi.db.connection;

    const rows = await knex('tracks')
      .select(
        'tracks.*',
        knex.raw(
          `ST_AsGeoJSON(
            ST_SimplifyPreserveTopology(
              ST_GeomFromGeoJSON(tracks.route_geojson::text),
              ?
            )
          ) as route_geojson`,
          [tolerance]
        ),
        // Include original and simplified point counts
        knex.raw(
          `ST_NPoints(ST_GeomFromGeoJSON(tracks.route_geojson::text)) as original_points`
        ),
        knex.raw(
          `ST_NPoints(
            ST_SimplifyPreserveTopology(
              ST_GeomFromGeoJSON(tracks.route_geojson::text),
              ?
            )
          ) as simplified_points`,
          [tolerance]
        )
      )
      .where('tracks.id', trackId)
      .whereNotNull('tracks.route_geojson')
      .first();

    if (!rows) return null;

    return {
      ...rows,
      route_geojson: typeof rows.route_geojson === 'string'
        ? JSON.parse(rows.route_geojson)
        : rows.route_geojson,
      original_points: parseInt(rows.original_points, 10),
      simplified_points: parseInt(rows.simplified_points, 10),
    };
  },

  /**
   * Find tracks whose route_geojson intersects a circle of `radius` meters
   * around (lat, lon). Optionally simplify the returned geometry using
   * ST_SimplifyPreserveTopology (Douglas-Peucker).
   *
   * NOTE: Uses geography casts so ST_DWithin works in meters (not degrees).
   */
  async findNearby(
    lat: number,
    lon: number,
    radius: number = 5000,
    tolerance?: number
  ): Promise<any[]> {
    const knex = strapi.db.connection;

    const query = knex('tracks')
      .select(
        'tracks.*',
        // If tolerance is provided, simplify the geometry and return as GeoJSON
        tolerance != null
          ? knex.raw(
              `ST_AsGeoJSON(
                ST_SimplifyPreserveTopology(
                  ST_GeomFromGeoJSON(tracks.route_geojson::text),
                  ?
                )
              ) as route_geojson`,
              [tolerance]
            )
          : knex.raw(`tracks.route_geojson::text as route_geojson`),
        // Distance in meters from search point
        knex.raw(
          `ST_Distance(
            ST_GeomFromGeoJSON(tracks.route_geojson::text)::geography,
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
          ) as distance_meters`,
          [lon, lat]
        )
      )
      .whereNotNull('tracks.route_geojson')
      .whereRaw(
        `ST_DWithin(
          ST_GeomFromGeoJSON(tracks.route_geojson::text)::geography,
          ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
          ?
        )`,
        [lon, lat, radius]
      )
      .orderByRaw(
        `ST_Distance(
          ST_GeomFromGeoJSON(tracks.route_geojson::text)::geography,
          ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
        )`,
        [lon, lat]
      )
      .limit(100);

    const rows = await query;

    // Parse JSON fields that Knex returns as strings
    return rows.map((row: any) => ({
      ...row,
      route_geojson: typeof row.route_geojson === 'string'
        ? JSON.parse(row.route_geojson)
        : row.route_geojson,
      distance_meters: row.distance_meters
        ? parseFloat(row.distance_meters)
        : null,
    }));
  },

  /**
   * Extract individual waypoints from a track's route_geojson that fall
   * inside the given bounding box.
   *
   * Uses ST_DumpPoints + && (bounding-box overlap) for filtering.
   * Returns an array of { lon, lat, point_index }.
   */
  async findWaypointsInBbox(
    trackId: string | number,
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number
  ): Promise<{ lon: number; lat: number; point_index: number }[]> {
    const knex = strapi.db.connection;

    const rows = await knex.raw(
      `
      SELECT
        ST_X(geom) AS lon,
        ST_Y(geom) AS lat,
        path[1] AS point_index
      FROM (
        SELECT
          (ST_DumpPoints(
            ST_GeomFromGeoJSON(route_geojson::text)
          )).*
        FROM tracks
        WHERE id = ? AND route_geojson IS NOT NULL
      ) sub
      WHERE geom && ST_MakeEnvelope(?, ?, ?, ?, 4326)
      ORDER BY point_index
      `,
      [trackId, minLon, minLat, maxLon, maxLat]
    );

    return (rows.rows || rows).map((r: any) => ({
      lon: parseFloat(r.lon),
      lat: parseFloat(r.lat),
      point_index: parseInt(r.point_index, 10),
    }));
  },
}));
