/**
 * ride controller — C-01 (CRUD + RBAC + idempotency + stats) and
 *                    C-02 (binary waypoints upload/download + SHA-256 verify).
 *
 * Core CRUD routes run under the users-permissions policy (permissions seeded
 * for the `authenticated` role). The custom binary routes are `auth: false` and
 * authenticate manually via getAuthenticatedUser (see routes/ride.ts).
 */

import { factories } from '@strapi/strapi';
import { verifyBlob } from '../../../utils/blob-codec';
import {
  getAuthenticatedUser,
  isAdminUser,
  readRawBody,
  sendError,
} from '../../../utils/request-helpers';

const UID = 'api::ride.ride';

/** Connect a ride's owner via the document service (no route-level validation). */
async function connectRideOwner(
  strapi: any,
  rideDocumentId: string,
  userId: number | string
): Promise<void> {
  await strapi.documents(UID).update({
    documentId: rideDocumentId,
    data: { user: userId } as any,
  });
}

/** Maintain Profile aggregate stats after a ride is created (C-01). */
async function bumpProfileStats(strapi: any, userId: number | string, data: any) {
  const profile = await strapi
    .service('api::profile.profile')
    .findOrCreateForUser(userId, {});
  if (!profile?.id) return;

  const dist = Number(data.total_distance_m) || 0;
  const ms = Number(data.duration_ms) || 0;
  const knex = strapi.db.connection;
  await knex('profiles')
    .where({ id: profile.id })
    .update({
      rides_count: knex.raw('COALESCE(rides_count, 0) + 1'),
      total_distance_m: knex.raw('COALESCE(total_distance_m, 0) + ?', [dist]),
      total_time_ms: knex.raw('COALESCE(total_time_ms, 0) + ?', [ms]),
    });
}

export default factories.createCoreController(UID, ({ strapi }) => ({
  // ──────────────────────────────────────────────────────────────
  // find — own rides + public rides of others; never deleted
  // ──────────────────────────────────────────────────────────────
  async find(ctx) {
    const user = ctx.state.user;
    const isAdmin = isAdminUser(user);

    if (!isAdmin) {
      const ownership = user
        ? {
            $or: [
              { user: { id: { $eq: user.id } } },
              { visibility: { $eq: 'public' } },
            ],
          }
        : { visibility: { $eq: 'public' } };

      const conditions: any[] = [ownership, { deleted_at: { $null: true } }];
      if (ctx.query.filters) conditions.unshift(ctx.query.filters);

      ctx.query = {
        ...ctx.query,
        filters: {
          $and: conditions,
        },
      };
    }

    // Note: waypoints_blob is not a Strapi attribute, so the feed never carries
    // the blob — it is only reachable via GET /rides/:id/waypoints (C-02).
    return super.find(ctx);
  },

  // ──────────────────────────────────────────────────────────────
  // findOne — owner or public
  // ──────────────────────────────────────────────────────────────
  async findOne(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;

    const ride = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['user'] });

    if (!ride || (ride as any).deleted_at) return ctx.notFound('Ride not found');

    const isOwner = user && (ride as any).user?.id === user.id;
    if (!isAdminUser(user) && !isOwner && ride.visibility !== 'public') {
      return ctx.forbidden('You can only access your own or public rides');
    }

    return super.findOne(ctx);
  },

  // ──────────────────────────────────────────────────────────────
  // create — ride_uid idempotency + source_bin dedup + owner + stats
  // ──────────────────────────────────────────────────────────────
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Authentication required');

    const data = ctx.request.body?.data || {};

    // Idempotency: same ride_uid → return the existing ride (retry-safe).
    if (data.ride_uid) {
      const existing = await strapi.documents(UID).findMany({
        filters: { ride_uid: { $eq: data.ride_uid } },
        populate: ['user'],
        limit: 1,
      });
      if (existing && existing.length > 0) {
        const e = existing[0] as any;
        if (e.user?.id && e.user.id !== user.id && !isAdminUser(user)) {
          return ctx.forbidden('ride_uid belongs to another user');
        }
        // Self-heal: if a previous attempt died between create and owner-link,
        // (re)connect the owner here so the ride is never left orphaned.
        if (!e.user?.id) {
          await connectRideOwner(strapi, e.documentId, user.id);
          const healed = await strapi
            .documents(UID)
            .findOne({ documentId: e.documentId, populate: ['user'] });
          ctx.status = 201;
          return { data: healed };
        }
        ctx.status = 201;
        return { data: e };
      }
    }

    // Dedup: the same source .bin already uploaded by this user → 409.
    if (data.source_bin_sha256) {
      const dup = await strapi.documents(UID).findMany({
        filters: {
          source_bin_sha256: { $eq: data.source_bin_sha256 },
          user: { id: { $eq: user.id } },
        },
        limit: 1,
      });
      if (dup && dup.length > 0) {
        return sendError(
          ctx,
          409,
          'ConflictError',
          'This .bin has already been uploaded',
          { existing_ride_id: (dup[0] as any).documentId }
        );
      }
    }

    // NOTE: `user` is deliberately NOT injected into ctx.request.body.data.
    // Strapi 5's input validation (throwRestrictedRelations) rejects relations
    // to plugin::users-permissions.user in the body unless the caller role holds
    // plugin::users-permissions.user.find — which must never be granted (it
    // would let any user list all users). The owner is connected after create
    // via the document service, which does not run route-level validation.
    const response = await super.create(ctx);

    const created = (response as any)?.data;
    if (created?.documentId) {
      await connectRideOwner(strapi, created.documentId, user.id);

      // Maintain Profile aggregate stats (C-01). Non-fatal.
      await bumpProfileStats(strapi, user.id, data).catch((err: any) =>
        strapi.log.warn(`[ride.create] profile stats bump failed: ${err?.message || err}`)
      );

      const withOwner = await strapi
        .documents(UID)
        .findOne({ documentId: created.documentId, populate: ['user'] });
      return { data: withOwner };
    }

    return response;
  },

  // ──────────────────────────────────────────────────────────────
  // update — ownership
  // ──────────────────────────────────────────────────────────────
  async update(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;

    const ride = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['user'] });
    if (!ride) return ctx.notFound('Ride not found');

    if (!isAdminUser(user) && (ride as any).user?.id !== user?.id) {
      return ctx.forbidden('You can only update your own rides');
    }

    return super.update(ctx);
  },

  // ──────────────────────────────────────────────────────────────
  // delete — ownership, SOFT delete (deleted_at)
  // ──────────────────────────────────────────────────────────────
  async delete(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;

    const ride = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['user'] });
    if (!ride) return ctx.notFound('Ride not found');

    if (!isAdminUser(user) && (ride as any).user?.id !== user?.id) {
      return ctx.forbidden('You can only delete your own rides');
    }

    const updated = await strapi.documents(UID).update({
      documentId: id,
      data: { deleted_at: new Date().toISOString() } as any,
    });
    return { data: updated };
  },

  // ──────────────────────────────────────────────────────────────
  // Custom: PUT /rides/:id/waypoints  (application/octet-stream)
  // ──────────────────────────────────────────────────────────────
  async uploadWaypoints(ctx) {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return ctx.unauthorized('Authentication required');

    const { id } = ctx.params;
    const ride = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['user'] });
    if (!ride) return ctx.notFound('Ride not found');

    if (!isAdminUser(user) && (ride as any).user?.id !== user.id) {
      return ctx.forbidden('You can only upload to your own rides');
    }

    let raw: Buffer;
    try {
      raw = await readRawBody(ctx);
    } catch (err: any) {
      return sendError(ctx, 413, 'PayloadTooLargeError', err?.message || 'Payload too large');
    }

    const result = verifyBlob(raw, (ride as any).waypoint_count);
    if (!result.ok) {
      return sendError(ctx, 422, 'ValidationError', result.message || 'Blob rejected', {
        code: result.code,
        expected_sha256: result.expected_sha256,
        actual_sha256: result.actual_sha256,
      });
    }

    // Write the raw BYTEA on the same row (document_id), then metadata.
    const knex = strapi.db.connection;
    await knex('rides').where({ document_id: id }).update({ waypoints_blob: raw });

    const meta = result.meta!;
    const updated = await strapi.documents(UID).update({
      documentId: id,
      data: {
        waypoints_uploaded: true,
        waypoints_blob_bytes: meta.blobBytes,
        waypoints_blob_original_bytes: meta.payloadBytes,
        waypoints_blob_sha256: meta.sha256,
        waypoints_blob_codec: `${meta.codecName}-${meta.schemaName}`,
        waypoint_count: meta.count,
        sample_rate_hz: meta.sampleRateHz,
      } as any,
    });

    return {
      data: {
        id: (updated as any).id,
        document_id: id,
        waypoints_uploaded: true,
        waypoints_blob_bytes: meta.blobBytes,
        waypoints_blob_sha256: meta.sha256,
      },
    };
  },

  // ──────────────────────────────────────────────────────────────
  // Custom: GET /rides/:id/waypoints  → application/octet-stream
  // ──────────────────────────────────────────────────────────────
  async downloadWaypoints(ctx) {
    const user = await getAuthenticatedUser(ctx);

    const { id } = ctx.params;
    const ride = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['user'] });
    if (!ride || (ride as any).deleted_at) return ctx.notFound('Ride not found');

    const isOwner = user && (ride as any).user?.id === user.id;
    if (!isAdminUser(user) && !isOwner && ride.visibility !== 'public') {
      return ctx.forbidden('You can only download your own or public rides');
    }

    const knex = strapi.db.connection;
    const row = await knex('rides')
      .select('waypoints_blob')
      .where({ document_id: id })
      .first();

    if (!row?.waypoints_blob) {
      return ctx.notFound('No waypoints uploaded for this ride');
    }

    const buf: Buffer = Buffer.isBuffer(row.waypoints_blob)
      ? row.waypoints_blob
      : Buffer.from(row.waypoints_blob);

    const etag = `"${(ride as any).waypoints_blob_sha256 || ''}"`;
    if ((ride as any).waypoints_blob_sha256 && ctx.headers['if-none-match'] === etag) {
      ctx.status = 304;
      return;
    }

    ctx.set('ETag', etag);
    ctx.set('Content-Type', 'application/octet-stream');
    ctx.set('Content-Length', String(buf.length));
    ctx.body = buf;
  },
}));
