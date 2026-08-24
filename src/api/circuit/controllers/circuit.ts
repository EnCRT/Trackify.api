/**
 * Circuit controller — C-03.
 *
 * Public read (verified circuits are readable by anyone; owners also see their
 * own drafts), owner/admin write, layout-aware gates validation, and the
 * leaderboard endpoint. Custom geo routes (nearby/waypoints/simplify) are public.
 */

import { factories } from '@strapi/strapi';
import {
  validateGeoJSONGeometry,
  extractWaypoints,
} from '../../../utils/geojson-validator';
import { isAdminUser } from '../../../utils/request-helpers';

const UID = 'api::circuit.circuit';

// ── gates validation ────────────────────────────────────────────────────────

function isPoint(p: any): boolean {
  return (
    p &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180
  );
}

function isLine(line: any): boolean {
  return Array.isArray(line) && line.length === 2 && line.every(isPoint);
}

function validateSectors(sectors: any, errors: string[]): void {
  if (sectors === undefined) return;
  if (!Array.isArray(sectors)) {
    errors.push('gates.sectors must be an array of 2-point lines');
    return;
  }
  sectors.forEach((s: any, i: number) => {
    if (!isLine(s)) errors.push(`gates.sectors[${i}] must be a line of 2 {lat,lon} points`);
  });
}

/** Validate `gates` structure for the given layout (AUDIT §9.2). */
function validateGates(layout: string, gates: any): string[] {
  const errors: string[] = [];
  if (!gates || typeof gates !== 'object') {
    errors.push('gates is required and must be an object');
    return errors;
  }

  if (layout === 'closed_loop') {
    if (!isLine(gates.start_finish)) {
      errors.push('closed_loop requires gates.start_finish (a line of 2 {lat,lon} points)');
    }
    validateSectors(gates.sectors, errors);
  } else if (layout === 'point_to_point') {
    if (!isLine(gates.start)) {
      errors.push('point_to_point requires gates.start (a line of 2 {lat,lon} points)');
    }
    if (!isLine(gates.finish)) {
      errors.push('point_to_point requires gates.finish (a line of 2 {lat,lon} points)');
    }
    validateSectors(gates.sectors, errors);
  } else {
    errors.push(`unknown layout "${layout}" (expected closed_loop | point_to_point)`);
  }
  return errors;
}

export default factories.createCoreController(UID, ({ strapi }) => ({
  // ──────────────────────────────────────────────────────────────
  // find — public: verified circuits + (auth) own drafts
  // ──────────────────────────────────────────────────────────────
  async find(ctx) {
    const user = ctx.state.user;
    if (isAdminUser(user)) return super.find(ctx);

    const visible: any[] = [{ verified: { $eq: true } }];
    if (user) visible.push({ created_by_user: { id: { $eq: user.id } } });

    // Owner/visibility-scoped query via the Document Service (see
    // motorcycle.find): the REST validator rejects relation filters to
    // users-permissions.user.
    const filters = {
      ...(ctx.query.filters || {}),
      $or: visible,
      deleted_at: { $null: true },
    };

    const { results, pagination } = await strapi.service(UID).find({
      ...ctx.query,
      filters,
    });
    const sanitizedResults = await (this as any).sanitizeOutput(results, ctx);
    return (this as any).transformResponse(sanitizedResults, { pagination });
  },

  // ──────────────────────────────────────────────────────────────
  // findOne — verified, owner, or admin
  // ──────────────────────────────────────────────────────────────
  async findOne(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;

    const circuit = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['created_by_user'] });
    if (!circuit || (circuit as any).deleted_at) return ctx.notFound('Circuit not found');

    const isOwner = user && (circuit as any).created_by_user?.id === user.id;
    if (!isAdminUser(user) && !isOwner && !(circuit as any).verified) {
      return ctx.forbidden('This circuit is not published yet');
    }
    return super.findOne(ctx);
  },

  // ──────────────────────────────────────────────────────────────
  // create — validate geojson + gates, force unverified, assign owner
  // ──────────────────────────────────────────────────────────────
  async create(ctx) {
    const data = ctx.request.body?.data || {};

    if (data.route_geojson) {
      const errs = validateGeoJSONGeometry(data.route_geojson);
      if (errs.length) return ctx.badRequest('GeoJSON validation failed', { errors: errs });
    }

    const gateErrors = validateGates(data.layout, data.gates);
    if (gateErrors.length) {
      return ctx.badRequest('Gates validation failed', { errors: gateErrors });
    }

    // NOTE: `created_by_user` is NOT injected into the body — Strapi 5 input
    // validation rejects relations to plugin::users-permissions.user in the
    // body unless the caller role holds that content-type's `find`, which must
    // never be granted (it would let any user list all users). The relation is
    // connected after create via the document service (no route validation).
    ctx.request.body.data = { ...data, verified: false };
    const response = await super.create(ctx);

    const created = (response as any)?.data;
    if (created?.documentId && ctx.state.user) {
      await strapi.documents(UID).update({
        documentId: created.documentId,
        data: { created_by_user: ctx.state.user.id } as any,
      });
      const withOwner = await strapi
        .documents(UID)
        .findOne({ documentId: created.documentId, populate: ['created_by_user'] });
      return { data: withOwner };
    }

    return response;
  },

  // ──────────────────────────────────────────────────────────────
  // update — owner/admin, validate geojson + gates
  // ──────────────────────────────────────────────────────────────
  async update(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;
    const data = ctx.request.body?.data || {};

    const circuit = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['created_by_user'] });
    if (!circuit) return ctx.notFound('Circuit not found');

    if (!isAdminUser(user) && (circuit as any).created_by_user?.id !== user?.id) {
      return ctx.forbidden('You can only update your own circuits');
    }

    if (data.route_geojson) {
      const errs = validateGeoJSONGeometry(data.route_geojson);
      if (errs.length) return ctx.badRequest('GeoJSON validation failed', { errors: errs });
    }

    // Validate gates against the effective layout (new value or the stored one).
    if (data.gates !== undefined || data.layout !== undefined) {
      const layout = data.layout ?? (circuit as any).layout;
      const gates = data.gates ?? (circuit as any).gates;
      const gateErrors = validateGates(layout, gates);
      if (gateErrors.length) {
        return ctx.badRequest('Gates validation failed', { errors: gateErrors });
      }
    }

    // Only admins may flip `verified`.
    if (!isAdminUser(user) && 'verified' in data) {
      delete ctx.request.body.data.verified;
    }

    return super.update(ctx);
  },

  // ──────────────────────────────────────────────────────────────
  // delete — owner/admin, soft delete
  // ──────────────────────────────────────────────────────────────
  async delete(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;

    const circuit = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['created_by_user'] });
    if (!circuit) return ctx.notFound('Circuit not found');

    if (!isAdminUser(user) && (circuit as any).created_by_user?.id !== user?.id) {
      return ctx.forbidden('You can only delete your own circuits');
    }

    const updated = await strapi.documents(UID).update({
      documentId: id,
      data: { deleted_at: new Date().toISOString() } as any,
    });
    return { data: updated };
  },

  // ──────────────────────────────────────────────────────────────
  // Custom: GET /circuits/:id/leaderboard?limit=
  //
  // Best-lap-per-ride ranking. Laps are no longer a separate collection —
  // each ride caches its best lap in `best_lap_ms` (computed on the client from
  // the waypoints blob), so the leaderboard is simply the rides attached to this
  // circuit ordered by that value. One entry per ride ("лучший круг за заезд").
  // ──────────────────────────────────────────────────────────────
  async leaderboard(ctx) {
    const { id } = ctx.params;
    const limit = Math.min(parseInt((ctx.query.limit as string) || '10', 10) || 10, 100);

    const circuit = await strapi.documents(UID).findOne({ documentId: id });
    if (!circuit) return ctx.notFound('Circuit not found');

    const rides = await strapi.documents('api::ride.ride').findMany({
      filters: {
        circuit: { documentId: id },
        best_lap_ms: { $notNull: true },
        deleted_at: { $null: true },
        visibility: { $in: ['public', 'unlisted'] },
      },
      sort: 'best_lap_ms:asc',
      limit,
      populate: ['user', 'vehicle'],
    });

    const data = rides.map((ride: any, i: number) => ({
      rank: i + 1,
      ride_id: ride.documentId,
      ride_name: ride.name,
      duration_ms: ride.best_lap_ms,
      set_at: ride.start_time ?? ride.createdAt ?? null,
      rider: ride.user ? { id: ride.user.id, username: ride.user.username } : null,
      vehicle: ride.vehicle
        ? { name: ride.vehicle.name, brand: ride.vehicle.brand, model: ride.vehicle.model }
        : null,
    }));

    return { data, meta: { circuit_id: id, count: data.length } };
  },

  // ──────────────────────────────────────────────────────────────
  // Custom: GET /circuits/:id/waypoints
  // ──────────────────────────────────────────────────────────────
  async waypoints(ctx) {
    const { id } = ctx.params;
    const { bbox } = ctx.query;

    try {
      const circuit = await strapi.service(UID).findOne(id, { populate: [] });
      if (!circuit) return ctx.notFound('Circuit not found');
      if (!circuit.route_geojson) return { data: [], meta: { total: 0 } };

      let points = extractWaypoints(circuit.route_geojson);
      if (bbox) {
        const parts = (bbox as string).split(',').map(Number);
        if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
          const [minLon, minLat, maxLon, maxLat] = parts;
          points = points.filter(
            (p) => p.lon >= minLon && p.lon <= maxLon && p.lat >= minLat && p.lat <= maxLat
          );
        } else {
          return ctx.badRequest(
            'bbox must be: minLon,minLat,maxLon,maxLat (4 comma-separated numbers)'
          );
        }
      }
      return { data: points, meta: { total: points.length } };
    } catch (err: any) {
      strapi.log.error('[circuit.waypoints]', err);
      return ctx.internalServerError('Failed to extract waypoints');
    }
  },

  // ──────────────────────────────────────────────────────────────
  // Custom: GET /circuits/:id/simplify
  // ──────────────────────────────────────────────────────────────
  async simplify(ctx) {
    const { id } = ctx.params;
    const { tolerance, zoom } = ctx.query;

    let tol: number;
    if (zoom) {
      const { toleranceForZoom } = await import('../../../utils/douglas-peucker');
      tol = toleranceForZoom(parseInt(zoom as string, 10));
    } else if (tolerance) {
      tol = parseFloat(tolerance as string);
      if (isNaN(tol) || tol <= 0) return ctx.badRequest('tolerance must be a positive number');
    } else {
      return ctx.badRequest('Either tolerance (degrees) or zoom (1-18) is required');
    }

    try {
      const result = await strapi.service(UID).simplifyCircuit(id, tol);
      if (!result) return ctx.notFound('Circuit not found or has no route_geojson');
      return { data: result };
    } catch (err: any) {
      strapi.log.error('[circuit.simplify]', err);
      return ctx.internalServerError('Simplification failed');
    }
  },

  // ──────────────────────────────────────────────────────────────
  // Custom: GET /circuits/nearby
  // ──────────────────────────────────────────────────────────────
  async nearby(ctx) {
    const { lat, lon, radius = '5000' } = ctx.query;
    if (!lat || !lon) return ctx.badRequest('lat and lon query params are required');

    const latNum = parseFloat(lat as string);
    const lonNum = parseFloat(lon as string);
    const radiusNum = parseFloat(radius as string);
    const tolerance = ctx.query.tolerance ? parseFloat(ctx.query.tolerance as string) : undefined;

    if (isNaN(latNum) || isNaN(lonNum) || isNaN(radiusNum)) {
      return ctx.badRequest('lat, lon, and radius must be valid numbers');
    }

    try {
      const circuits = await strapi.service(UID).findNearby(latNum, lonNum, radiusNum, tolerance);
      return { data: circuits, meta: { count: circuits.length } };
    } catch (err: any) {
      strapi.log.error('[circuit.nearby]', err);
      return ctx.internalServerError('Spatial query failed');
    }
  },
}));
