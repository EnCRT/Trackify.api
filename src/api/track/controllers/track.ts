/**
 * Track controller — core CRUD + RBAC filtering + GeoJSON validation + geo endpoints
 */

import { factories } from '@strapi/strapi';
import {
  validateGeoJSONGeometry,
  extractWaypoints,
} from '../../../utils/geojson-validator';

export default factories.createCoreController(
  'api::track.track',
  ({ strapi }) => ({
    // ──────────────────────────────────────────────────────────────
    // Override find: RBAC — users see only their own tracks
    // ──────────────────────────────────────────────────────────────
    async find(ctx) {
      const { state } = ctx;
      const user = state.user;

      const isAdmin =
        user?.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

      if (!isAdmin && user) {
        ctx.query = {
          ...ctx.query,
          filters: {
            $and: [
              ctx.query.filters || {},
              { user: { id: { $eq: user.id } } },
            ],
          },
        };
      }

      return super.find(ctx);
    },

    // ──────────────────────────────────────────────────────────────
    // Override findOne: RBAC
    // ──────────────────────────────────────────────────────────────
    async findOne(ctx) {
      const { state } = ctx;
      const user = state.user;

      const entity = await super.findOne(ctx);
      if (!entity) return entity;

      const data = (entity as any)?.data ?? entity;
      const isAdmin =
        user?.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

      if (!isAdmin && user && data?.user?.id !== user.id) {
        return ctx.forbidden('You can only access your own tracks');
      }

      return entity;
    },

    // ──────────────────────────────────────────────────────────────
    // Override create: validate GeoJSON coordinates
    // ──────────────────────────────────────────────────────────────
    async create(ctx) {
      const { data } = ctx.request.body || {};

      // Validate GeoJSON if present
      if (data?.route_geojson) {
        const errors = validateGeoJSONGeometry(data.route_geojson);
        if (errors.length > 0) {
          return ctx.badRequest('GeoJSON validation failed', { errors });
        }
      }

      // Auto-assign authenticated user
      if (ctx.state.user) {
        ctx.request.body.data = {
          ...(ctx.request.body.data || {}),
          user: ctx.state.user.id,
        };
      }

      return super.create(ctx);
    },

    // ──────────────────────────────────────────────────────────────
    // Override update: validate GeoJSON coordinates
    // ──────────────────────────────────────────────────────────────
    async update(ctx) {
      const { data } = ctx.request.body || {};

      // Validate GeoJSON if present
      if (data?.route_geojson) {
        const errors = validateGeoJSONGeometry(data.route_geojson);
        if (errors.length > 0) {
          return ctx.badRequest('GeoJSON validation failed', { errors });
        }
      }

      // RBAC: verify ownership before allowing update
      if (ctx.state.user) {
        const existing = await strapi
          .service('api::track.track')
          .findOne(ctx.params.id, { populate: ['user'] });

        const isAdmin = ctx.state.user.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

        if (!isAdmin && existing?.user?.id !== ctx.state.user.id) {
          return ctx.forbidden('You can only update your own tracks');
        }
      }

      return super.update(ctx);
    },

    // ──────────────────────────────────────────────────────────────
    // Override delete: RBAC
    // ──────────────────────────────────────────────────────────────
    async delete(ctx) {
      if (ctx.state.user) {
        const existing = await strapi
          .service('api::track.track')
          .findOne(ctx.params.id, { populate: ['user'] });

        const isAdmin = ctx.state.user.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

        if (!isAdmin && existing?.user?.id !== ctx.state.user.id) {
          return ctx.forbidden('You can only delete your own tracks');
        }
      }

      return super.delete(ctx);
    },

    // ──────────────────────────────────────────────────────────────
    // Custom: GET /api/tracks/:id/waypoints
    // List all waypoints from route_geojson with optional bbox filter
    // ──────────────────────────────────────────────────────────────
    async waypoints(ctx) {
      const { id } = ctx.params;
      const { bbox } = ctx.query;

      try {
        const track = await strapi
          .service('api::track.track')
          .findOne(id, { populate: [] });

        if (!track) {
          return ctx.notFound('Track not found');
        }

        if (!track.route_geojson) {
          return { data: [], meta: { total: 0 } };
        }

        let points = extractWaypoints(track.route_geojson);

        // Optional bbox filter: minLon,minLat,maxLon,maxLat
        if (bbox) {
          const parts = (bbox as string).split(',').map(Number);
          if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
            const [minLon, minLat, maxLon, maxLat] = parts;
            points = points.filter(
              (p) =>
                p.lon >= minLon &&
                p.lon <= maxLon &&
                p.lat >= minLat &&
                p.lat <= maxLat
            );
          } else {
            return ctx.badRequest(
              'bbox must be: minLon,minLat,maxLon,maxLat (4 comma-separated numbers)'
            );
          }
        }

        return { data: points, meta: { total: points.length } };
      } catch (err: any) {
        strapi.log.error('[track.waypoints]', err);
        return ctx.internalServerError('Failed to extract waypoints');
      }
    },

    // ──────────────────────────────────────────────────────────────
    // Custom: GET /api/tracks/:id/simplify
    // ──────────────────────────────────────────────────────────────
    async simplify(ctx) {
      const { id } = ctx.params;
      const { tolerance, zoom } = ctx.query;

      let tol: number;

      if (zoom) {
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

    // ──────────────────────────────────────────────────────────────
    // Custom: GET /api/tracks/nearby
    // ──────────────────────────────────────────────────────────────
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

    // ──────────────────────────────────────────────────────────────
    // Custom: GET /api/tracks/nearby?lat=X&lon=Y&radius=5000&tolerance=0.0001
    // Already implemented above
  })
);
