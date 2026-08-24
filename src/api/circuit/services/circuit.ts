/**
 * circuit service — core CRUD + PostGIS spatial helpers.
 *
 * Renamed from the old `track` service (task B-01). Knex table refs
 * updated tracks→circuits; `simplifyTrack` → `simplifyCircuit`.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService(
  'api::circuit.circuit',
  ({ strapi }) => ({
    /**
     * Simplify a single circuit's route_geojson using PostGIS.
     * @returns the circuit with simplified route_geojson, or null if not found / no route.
     */
    async simplifyCircuit(
      circuitId: string | number,
      tolerance: number
    ): Promise<any | null> {
      const knex = strapi.db.connection;

      const rows = await knex('circuits')
        .select(
          'circuits.*',
          knex.raw(
            `ST_AsGeoJSON(
              ST_SimplifyPreserveTopology(
                ST_GeomFromGeoJSON(circuits.route_geojson::text),
                ?
              )
            ) as route_geojson`,
            [tolerance]
          ),
          knex.raw(
            `ST_NPoints(ST_GeomFromGeoJSON(circuits.route_geojson::text)) as original_points`
          ),
          knex.raw(
            `ST_NPoints(
              ST_SimplifyPreserveTopology(
                ST_GeomFromGeoJSON(circuits.route_geojson::text),
                ?
              )
            ) as simplified_points`,
            [tolerance]
          )
        )
        .where('circuits.id', circuitId)
        .whereNotNull('circuits.route_geojson')
        .first();

      if (!rows) return null;

      return {
        ...rows,
        route_geojson:
          typeof rows.route_geojson === 'string'
            ? JSON.parse(rows.route_geojson)
            : rows.route_geojson,
        original_points: parseInt(rows.original_points, 10),
        simplified_points: parseInt(rows.simplified_points, 10),
      };
    },

    /**
     * Find circuits whose route_geojson intersects a circle of `radius` meters
     * around (lat, lon). Optionally simplify the returned geometry.
     * Uses geography casts so ST_DWithin works in meters.
     */
    async findNearby(
      lat: number,
      lon: number,
      radius: number = 5000,
      tolerance?: number
    ): Promise<any[]> {
      const knex = strapi.db.connection;

      const query = knex('circuits')
        .select(
          'circuits.*',
          tolerance != null
            ? knex.raw(
                `ST_AsGeoJSON(
                  ST_SimplifyPreserveTopology(
                    ST_GeomFromGeoJSON(circuits.route_geojson::text),
                    ?
                  )
                ) as route_geojson`,
                [tolerance]
              )
            : knex.raw(`circuits.route_geojson::text as route_geojson`),
          knex.raw(
            `ST_Distance(
              ST_GeomFromGeoJSON(circuits.route_geojson::text)::geography,
              ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
            ) as distance_meters`,
            [lon, lat]
          )
        )
        .whereNotNull('circuits.route_geojson')
        .whereRaw(
          `ST_DWithin(
            ST_GeomFromGeoJSON(circuits.route_geojson::text)::geography,
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
            ?
          )`,
          [lon, lat, radius]
        )
        .orderByRaw(
          `ST_Distance(
            ST_GeomFromGeoJSON(circuits.route_geojson::text)::geography,
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
          )`,
          [lon, lat]
        )
        .limit(100);

      const rows = await query;

      return rows.map((row: any) => ({
        ...row,
        route_geojson:
          typeof row.route_geojson === 'string'
            ? JSON.parse(row.route_geojson)
            : row.route_geojson,
        distance_meters: row.distance_meters
          ? parseFloat(row.distance_meters)
          : null,
      }));
    },

    /**
     * Extract individual waypoints from a circuit's route_geojson within a bbox.
     */
    async findWaypointsInBbox(
      circuitId: string | number,
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
          FROM circuits
          WHERE id = ? AND route_geojson IS NOT NULL
        ) sub
        WHERE geom && ST_MakeEnvelope(?, ?, ?, ?, 4326)
        ORDER BY point_index
        `,
        [circuitId, minLon, minLat, maxLon, maxLat]
      );

      return (rows.rows || rows).map((r: any) => ({
        lon: parseFloat(r.lon),
        lat: parseFloat(r.lat),
        point_index: parseInt(r.point_index, 10),
      }));
    },
  })
);
