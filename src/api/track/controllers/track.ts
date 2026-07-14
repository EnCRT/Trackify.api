/**
 * track controller — core CRUD + geo endpoints
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController(
  'api::track.track',
  ({ strapi }) => ({
    /**
     * GET /api/tracks/:id/simplify?tolerance=0.001&zoom=10
     *
     * Returns the track with its route_geojson simplified using
     * ST_SimplifyPreserveTopology (Douglas-Peucker). Accepts either
     * a raw tolerance in WGS84 degrees, or a zoom level (1-18)
     * which maps to pre-defined tolerances.
     */
    async simplify(ctx) {
      const { id } = ctx.params;
      const { tolerance, zoom } = ctx.query;

      let tol: number;

      if (zoom) {
        // Lazy-load the utility only when zoom-based tolerance is requested
        const { toleranceForZoom } = await import(
          '../../../utils/douglas-peucker'
        );
        tol = toleranceForZoom(parseInt(zoom as string, 10));
      } else if (tolerance) {
        tol = parseFloat(tolerance as string);
        if (isNaN(tol) || tol <= 0) {
          return ctx.badRequest('tolerance must be a positive number');
        }
      } else {
        return ctx.badRequest(
          'Either tolerance (degrees) or zoom (1-18) is required'
        );
      }

      try {
        const result = await strapi
          .service('api::track.track')
          .simplifyTrack(id, tol);

        if (!result) {
          return ctx.notFound('Track not found or has no route_geojson');
        }

        return { data: result };
      } catch (err: any) {
        strapi.log.error('[track.simplify]', err);
        return ctx.internalServerError('Simplification failed');
      }
    },

    /**
     * GET /api/tracks/nearby?lat=X&lon=Y&radius=5000&tolerance=0.0001
     *
     * Returns tracks whose route_geojson is within `radius` meters
     * of the given point (lat, lon). Uses ST_DWithin for spatial filtering.
     *
     * Query params:
     *   lat, lon  — center point (WGS84)
     *   radius    — search radius in meters (default 5000)
     *   tolerance — optional Douglas-Peucker tolerance for simplification
     *               (omit for full-resolution tracks)
     */
    async nearby(ctx) {
      const { lat, lon, radius = '5000' } = ctx.query;

      if (!lat || !lon) {
        return ctx.badRequest('lat and lon query params are required');
      }

      const latNum = parseFloat(lat as string);
      const lonNum = parseFloat(lon as string);
      const radiusNum = parseFloat(radius as string);
      const tolerance = ctx.query.tolerance
        ? parseFloat(ctx.query.tolerance as string)
        : undefined;

      if (isNaN(latNum) || isNaN(lonNum) || isNaN(radiusNum)) {
        return ctx.badRequest('lat, lon, and radius must be valid numbers');
      }

      try {
        const tracks = await strapi
          .service('api::track.track')
          .findNearby(latNum, lonNum, radiusNum, tolerance);

        return { data: tracks, meta: { count: tracks.length } };
      } catch (err: any) {
        strapi.log.error('[track.nearby]', err);
        return ctx.internalServerError('Spatial query failed');
      }
    },

    /**
     * GET /api/tracks/:id/waypoints?bbox=minLon,minLat,maxLon,maxLat
     *
     * Returns individual waypoints (coordinate pairs) from a track's
     * route_geojson that fall within the given bounding box.
     *
     * Query params:
     *   bbox — comma-separated: minLon,minLat,maxLon,maxLat (WGS84)
     */
    async waypoints(ctx) {
      const { id } = ctx.params;
      const { bbox } = ctx.query;

      if (!bbox) {
        return ctx.badRequest('bbox query param is required (minLon,minLat,maxLon,maxLat)');
      }

      const parts = (bbox as string).split(',').map(Number);
      if (parts.length !== 4 || parts.some(isNaN)) {
        return ctx.badRequest('bbox must be: minLon,minLat,maxLon,maxLat (4 comma-separated numbers)');
      }

      const [minLon, minLat, maxLon, maxLat] = parts;

      try {
        const points = await strapi
          .service('api::track.track')
          .findWaypointsInBbox(id, minLon, minLat, maxLon, maxLat);

        return { data: points, meta: { count: points.length } };
      } catch (err: any) {
        strapi.log.error('[track.waypoints]', err);
        return ctx.internalServerError('Waypoint query failed');
      }
    },
  })
);
