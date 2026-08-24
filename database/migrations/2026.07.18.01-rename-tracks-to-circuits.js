'use strict';

/**
 * Migration (B-01): rename the base table `tracks` → `circuits`.
 *
 * This preserves existing circuit ROW data (name, description, geometry, …) when
 * the content-type was renamed Track → Circuit.
 *
 * Scope & safety:
 *  - Fresh DB: `tracks` does not exist → this is a no-op; Strapi creates
 *    `circuits` from schema.json and the bootstrap ensureSchema() adds the
 *    PostGIS index.
 *  - Existing DB: `tracks` exists and `circuits` does not → rename the base
 *    table and drop the stale GIST index. The PostGIS index on `circuits` is
 *    (re)created by ensureSchema() at bootstrap.
 *
 * NOT migrated: Strapi 5 relation *link tables* (e.g. tracks_*_lnk). The Circuit
 * relations changed in B-01/B-03 (dropped `device`, added `created_by_user`), so
 * Strapi rebuilds link tables from the new schema. Any pre-existing track→user /
 * track→event links are not carried over — acceptable pre-launch (little/no data).
 * If you have production track data with relations, migrate the link rows by hand
 * before deploying.
 */

/** @param {import('knex').Knex} knex */
async function up(knex) {
  const hasTracks = await knex.schema.hasTable('tracks');
  const hasCircuits = await knex.schema.hasTable('circuits');

  if (hasTracks && !hasCircuits) {
    await knex.schema.renameTable('tracks', 'circuits');
    // eslint-disable-next-line no-console
    console.log('[migration:rename] tracks → circuits (base table renamed).');
  } else if (hasTracks && hasCircuits) {
    // eslint-disable-next-line no-console
    console.log(
      '[migration:rename] Both `tracks` and `circuits` exist — leaving as-is. ' +
        'Review manually; `tracks` is orphaned.'
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('[migration:rename] No `tracks` table — nothing to rename (fresh DB).');
  }

  // Drop the stale GIST index from the old table name (Postgres only).
  const client = knex.client.config.client;
  if (client === 'postgres' || client === 'postgresql' || client === 'pg') {
    await knex.raw('DROP INDEX IF EXISTS idx_tracks_route_geom;');
    // idx_circuits_route_geom is (re)created by ensureSchema() at bootstrap.
  }
}

/** @param {import('knex').Knex} knex */
async function down(knex) {
  const hasCircuits = await knex.schema.hasTable('circuits');
  const hasTracks = await knex.schema.hasTable('tracks');
  if (hasCircuits && !hasTracks) {
    await knex.schema.renameTable('circuits', 'tracks');
  }
}

module.exports = { up, down };
