/**
 * ensure-schema — idempotent, order-safe DB adjustments run at bootstrap.
 *
 * Why bootstrap and not a migration:
 *  - The raw `waypoints_blob` column is a Postgres BYTEA. Strapi has no binary
 *    attribute type, so it can't be declared in schema.json (B-02). We add the
 *    column ourselves.
 *  - Several performance indexes (B-10) target scalar columns Strapi owns.
 *  - Bootstrap runs AFTER Strapi's own schema sync, so every table/column this
 *    code references is guaranteed to exist — no migration-ordering races (cf.
 *    the defensive guards in the PostGIS migration).
 *
 * Everything here is guarded (hasTable/hasColumn) and idempotent
 * (IF NOT EXISTS / column existence checks), so it is safe on every start and
 * on both PostgreSQL and SQLite.
 *
 * NOTE on relation indexes: in Strapi 5 many-to-one FKs (ride.user, ride.circuit,
 * …) live in *link tables* (e.g. rides_user_lnk), which Strapi already indexes.
 * So B-10's "(user_id, …)" style indexes are covered by Strapi; here we only add
 * indexes on scalar columns that live directly on the row.
 */

import type { Core } from '@strapi/strapi';

function isPostgres(knex: any): boolean {
  const client = knex?.client?.config?.client;
  return client === 'postgres' || client === 'postgresql' || client === 'pg';
}

async function safe(strapi: Core.Strapi, label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err: any) {
    strapi.log.warn(`[ensure-schema] ${label} skipped: ${err?.message || err}`);
  }
}

/**
 * Add the BYTEA `waypoints_blob` column to `rides` if it is missing.
 * knex `.binary()` → `bytea` on Postgres, `blob` on SQLite.
 */
async function ensureRideBlobColumn(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection;
  if (!(await knex.schema.hasTable('rides'))) return;
  if (await knex.schema.hasColumn('rides', 'waypoints_blob')) return;

  await knex.schema.alterTable('rides', (t: any) => {
    t.binary('waypoints_blob');
  });
  strapi.log.info('[ensure-schema] Added column rides.waypoints_blob (bytea/blob).');
}

/**
 * B-10 scalar indexes. Postgres-focused; SQLite gets the plain btree ones too.
 */
async function ensureIndexes(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection;
  const pg = isPostgres(knex);

  const hasTable = async (t: string) => knex.schema.hasTable(t);
  const hasCols = async (t: string, cols: string[]) => {
    for (const c of cols) {
      if (!(await knex.schema.hasColumn(t, c))) return false;
    }
    return true;
  };

  // rides: feed + moderation + dedup
  if (await hasTable('rides')) {
    if (await hasCols('rides', ['created_at'])) {
      await safe(strapi, 'idx_rides_created_at', () =>
        knex.raw('CREATE INDEX IF NOT EXISTS idx_rides_created_at ON rides (created_at DESC);')
      );
    }
    if (await hasCols('rides', ['gps_quality_score', 'created_at'])) {
      await safe(strapi, 'idx_rides_quality_created', () =>
        knex.raw(
          'CREATE INDEX IF NOT EXISTS idx_rides_quality_created ON rides (gps_quality_score, created_at DESC);'
        )
      );
    }
    if (await hasCols('rides', ['source_bin_sha256'])) {
      await safe(strapi, 'idx_rides_source_bin', () =>
        knex.raw(
          'CREATE INDEX IF NOT EXISTS idx_rides_source_bin ON rides (source_bin_sha256);'
        )
      );
    }
    // GIN on tags (jsonb) — Postgres only
    if (pg && (await hasCols('rides', ['tags']))) {
      await safe(strapi, 'idx_rides_tags_gin', () =>
        knex.raw('CREATE INDEX IF NOT EXISTS idx_rides_tags_gin ON rides USING GIN (tags);')
      );
    }
    // Circuit leaderboard: rides ranked by best_lap_ms. The circuit FK lives in a
    // link table (rides_circuit_lnk, indexed by Strapi); this covers the sort part
    // once the circuit join has narrowed the set. Partial index skips NULL bests.
    if (pg && (await hasCols('rides', ['best_lap_ms']))) {
      await safe(strapi, 'idx_rides_best_lap', () =>
        knex.raw(
          'CREATE INDEX IF NOT EXISTS idx_rides_best_lap ON rides (best_lap_ms) WHERE best_lap_ms IS NOT NULL;'
        )
      );
    } else if (await hasCols('rides', ['best_lap_ms'])) {
      await safe(strapi, 'idx_rides_best_lap', () =>
        knex.raw('CREATE INDEX IF NOT EXISTS idx_rides_best_lap ON rides (best_lap_ms);')
      );
    }
  }

  // circuits: PostGIS GIST on route geometry (moved here from the tracks
  // migration so it is created post-sync on any DB — B-01/B-03).
  if (pg && (await hasTable('circuits')) && (await hasCols('circuits', ['route_geojson']))) {
    await safe(strapi, 'postgis extension', () =>
      knex.raw('CREATE EXTENSION IF NOT EXISTS postgis;')
    );
    await safe(strapi, 'idx_circuits_route_geom', () =>
      knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_circuits_route_geom
        ON circuits
        USING GIST (ST_GeomFromGeoJSON(route_geojson::text));
      `)
    );
  }
}

/**
 * Entry point — call from bootstrap after content-type schema sync.
 */
export async function ensureSchema(strapi: Core.Strapi): Promise<void> {
  await safe(strapi, 'ensureRideBlobColumn', () => ensureRideBlobColumn(strapi));
  await safe(strapi, 'ensureIndexes', () => ensureIndexes(strapi));
}
