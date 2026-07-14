'use strict';

/**
 * Migration: Enable PostGIS + GIST spatial index for Track routes.
 *
 * Strapi 5 auto-creates columns from schema.json diffs during its own
 * migration phase, so this migration assumes the `route_geojson` column
 * already exists (or will exist by the time Knex runs this).
 */

/**
 * @param {import('knex').Knex} knex
 */
async function up(knex) {
  // 1. Enable PostGIS extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis;');

  // 2. Create GIST index on geometry extracted from route_geojson JSON
  // Using an expression index: ST_GeomFromGeoJSON converts GeoJSON → geometry
  // We add IF NOT EXISTS so it's safe to re-run
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_tracks_route_geom
    ON tracks
    USING GIST (ST_GeomFromGeoJSON(route_geojson::text));
  `);
}

/**
 * @param {import('knex').Knex} knex
 */
async function down(knex) {
  // Drop the index
  await knex.raw('DROP INDEX IF EXISTS idx_tracks_route_geom;');

  // Don't drop the extension — other tables/features may use it.
  // Up to operator to decide.
}

module.exports = { up, down };
