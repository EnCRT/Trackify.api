/**
 * profile service — B-06.
 *
 * Exposes findOrCreateForUser(), used by auth.googleMobile to guarantee every
 * authenticated rider has a Profile row (B-06 DoD).
 */

import { factories } from '@strapi/strapi';

/** Normalize a datetime value (Date | epoch-ms number | ISO string | null) to ISO. */
function normalizeDate(value: any): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  // Strapi's SQLite dialect stores datetimes as epoch-millisecond integers.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

export default factories.createCoreService('api::profile.profile', ({ strapi }) => ({
  /**
   * Return the caller's Profile, creating it on first use.
   *
   * @param userId  users-permissions user id
   * @param seed    optional initial values (nickname/first_name/last_name/photo_url/supabase_uid)
   */
  async findOrCreateForUser(
    userId: number | string,
    seed: {
      nickname?: string;
      first_name?: string;
      last_name?: string;
      photo_url?: string;
      supabase_uid?: string;
    } = {}
  ): Promise<any> {
    const docs = strapi.documents('api::profile.profile');

    const existing = await docs.findMany({
      filters: { user: { id: { $eq: userId } } },
      populate: ['user'],
      limit: 1,
    });

    if (existing && existing.length > 0) {
      return existing[0];
    }

    return docs.create({
      data: {
        user: userId as any,
        units: 'metric',
        privacy_default: 'private',
        nickname: seed.nickname,
        first_name: seed.first_name,
        last_name: seed.last_name,
        photo_url: seed.photo_url,
        supabase_uid: seed.supabase_uid,
      },
    });
  },

  /**
   * Live Home-statistics aggregate over the caller's rides (P2: cloud-first
   * Home stats, GET /profiles/me/stats).
   *
   * Computed from the rides table on every call (soft-deleted rides excluded),
   * so unlike the cached Profile counters (bumped only on ride create) it stays
   * correct after deletions and reflects rides synced from any device.
   */
  async aggregateStatsForUser(userId: number | string): Promise<any> {
    const knex = strapi.db.connection;

    const shape = (row: any) => ({
      total_distance_m: Number(row?.total_distance_m) || 0,
      total_time_ms: Number(row?.total_time_ms) || 0,
      rides_count: Number(row?.rides_count) || 0,
      max_speed_mps: row?.max_speed_mps == null ? null : Number(row.max_speed_mps),
      best_lap_ms: row?.best_lap_ms == null ? null : Number(row.best_lap_ms),
      first_ride_at: normalizeDate(row?.first_ride_at),
      last_ride_at: normalizeDate(row?.last_ride_at),
    });

    // Fast path: one SQL aggregate through the Strapi 5 manyToOne link table
    // (rides_user_lnk: ride_id → user_id). pg returns bigint sums as strings,
    // so every numeric is coerced in shape().
    if (await knex.schema.hasTable('rides_user_lnk')) {
      const row = await knex('rides as r')
        .join('rides_user_lnk as u', 'u.ride_id', 'r.id')
        .where('u.user_id', userId)
        .whereNull('r.deleted_at')
        .select({
          total_distance_m: knex.raw('COALESCE(SUM(r.total_distance_m), 0)'),
          total_time_ms: knex.raw('COALESCE(SUM(r.duration_ms), 0)'),
          rides_count: knex.raw('COUNT(*)'),
          max_speed_mps: knex.raw('MAX(r.max_speed_mps)'),
          best_lap_ms: knex.raw('MIN(r.best_lap_ms)'),
          first_ride_at: knex.raw('MIN(r.start_time)'),
          last_ride_at: knex.raw('MAX(r.start_time)'),
        })
        .first();
      return shape(row);
    }

    // Defensive fallback (link table naming changed): aggregate through the
    // entity service. Personal ride counts are small, so in-memory is fine.
    const rides = (await strapi.documents('api::ride.ride').findMany({
      filters: { user: { id: { $eq: userId } }, deleted_at: { $null: true } },
      fields: [
        'total_distance_m',
        'duration_ms',
        'max_speed_mps',
        'best_lap_ms',
        'start_time',
      ],
      limit: -1,
    })) as any[];

    let total_distance_m = 0;
    let total_time_ms = 0;
    let max_speed_mps: number | null = null;
    let best_lap_ms: number | null = null;
    let first_ride_at: string | null = null;
    let last_ride_at: string | null = null;

    for (const r of rides) {
      total_distance_m += Number(r.total_distance_m) || 0;
      total_time_ms += Number(r.duration_ms) || 0;
      if (r.max_speed_mps != null) {
        const v = Number(r.max_speed_mps);
        max_speed_mps = max_speed_mps == null ? v : Math.max(max_speed_mps, v);
      }
      if (r.best_lap_ms != null) {
        const v = Number(r.best_lap_ms);
        best_lap_ms = best_lap_ms == null ? v : Math.min(best_lap_ms, v);
      }
      const ts = normalizeDate(r.start_time);
      if (ts) {
        if (!first_ride_at || ts < first_ride_at) first_ride_at = ts;
        if (!last_ride_at || ts > last_ride_at) last_ride_at = ts;
      }
    }

    return {
      total_distance_m,
      total_time_ms,
      rides_count: rides.length,
      max_speed_mps,
      best_lap_ms,
      first_ride_at,
      last_ride_at,
    };
  },
}));
