/**
 * Shared bootstrap helpers for the Trackify.API integration test suite.
 *
 * Each test file boots its own Strapi instance against a FRESH, isolated
 * SQLite database (better-sqlite3 — already a project dependency). The
 * instance is compiled from ./dist, so run `strapi build` once before tests
 * (scripts/ensure-build.js does this automatically via `npm test`).
 *
 * Environment is set programmatically BEFORE createStrapi()/load() so the
 * real .env (Postgres/Supabase) can never leak into the test run.
 */

import { createStrapi, type Core } from '@strapi/strapi';
import supertest from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const TEST_ROOT = path.resolve(__dirname, '..');

// ── Process env — must be set before Strapi reads its config ────────────────
process.env.NODE_ENV = 'test';
process.env.DATABASE_CLIENT = 'sqlite';
process.env.APP_KEYS ??= 'test-key-1,test-key-2,test-key-3,test-key-4';
process.env.API_TOKEN_SALT ??= 'test-api-token-salt';
process.env.ADMIN_JWT_SECRET ??= 'test-admin-jwt-secret';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.TRANSFER_TOKEN_SALT ??= 'test-transfer-salt';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
delete process.env.MIN_CLIENT_VERSION; // never gate tests by client version
delete process.env.GOOGLE_CLIENT_ID; // auth.googleMobile is exercised without credentials

const instances = new Map<string, Core.Strapi>();

/** Boot (once per process) a Strapi instance on a fresh SQLite DB. */
export async function bootStrapi(dbName: string): Promise<Core.Strapi> {
  const existing = instances.get(dbName);
  if (existing) return existing;

  process.env.DATABASE_FILENAME = `.tmp/${dbName}.db`;
  const dbPath = path.join(TEST_ROOT, '.tmp', `${dbName}.db`);
  fs.rmSync(dbPath, { force: true });

  const strapi = createStrapi({
    distDir: path.join(TEST_ROOT, 'dist'),
    serveAdminPanel: false,
  }) as Core.Strapi;

  await strapi.load();
  await strapi.server.mount();

  instances.set(dbName, strapi);
  return strapi;
}

/** Close a booted instance and remove its SQLite file. */
export async function shutdownStrapi(dbName: string): Promise<void> {
  const strapi = instances.get(dbName);
  if (!strapi) return;
  try {
    await strapi.server.httpServer.destroy();
  } catch {
    /* already gone */
  }
  try {
    await strapi.destroy();
  } catch {
    /* already gone */
  }
  instances.delete(dbName);
  fs.rmSync(path.join(TEST_ROOT, '.tmp', `${dbName}.db`), { force: true });
}

/** supertest agent bound to the test instance's HTTP server. */
export function request(dbName: string): supertest.SuperTest<supertest.Test> {
  const strapi = instances.get(dbName);
  if (!strapi) throw new Error(`No Strapi instance booted for "${dbName}"`);
  // @types/supertest vs supertest's own TestAgent types disagree on the
  // accepted server handle; the runtime accepts a Node http.Server.
  return supertest(strapi.server.httpServer as any) as unknown as supertest.SuperTest<supertest.Test>;
}

/** Direct access to the Strapi core (fixture seeding, internal APIs). */
export function core(dbName: string): Core.Strapi {
  const strapi = instances.get(dbName);
  if (!strapi) throw new Error(`No Strapi instance booted for "${dbName}"`);
  return strapi;
}

// ── Users & roles ───────────────────────────────────────────────────────────

export type RoleKind = 'authenticated' | 'admin';

/** Get (or create) a users-permissions role by its unique `type`. */
export async function ensureRole(dbName: string, type: RoleKind) {
  const strapi = core(dbName);
  let role = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type } });
  if (!role) {
    role = await strapi.db.query('plugin::users-permissions.role').create({
      data: { name: `Test ${type}`, description: `Test role (type=${type})`, type },
    });
  }
  return role;
}

const CRUD_ACTIONS = [
  'api::ride.ride',
  'api::motorcycle.motorcycle',
  'api::device.device',
  'api::sync-session.sync-session',
  'api::event.event',
  'api::circuit.circuit',
].flatMap((uid) => ['find', 'findOne', 'create', 'update', 'delete'].map((a) => `${uid}.${a}`));

/** Grant full CRUD permissions to a role (needed for the test admin role). */
export async function grantCrud(dbName: string, roleId: number | string) {
  const strapi = core(dbName);
  for (const action of CRUD_ACTIONS) {
    const existing = await strapi.db
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: roleId } });
    if (!existing) {
      await strapi.db
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: roleId } });
    }
  }
}

let userSeq = 0;

/** Create a confirmed users-permissions user and return it with its JWT. */
export async function createUser(
  dbName: string,
  username: string,
  opts: { role?: RoleKind; grant?: boolean } = {}
): Promise<{ user: any; jwt: string }> {
  const strapi = core(dbName);
  const roleType = opts.role ?? 'authenticated';
  const role = await ensureRole(dbName, roleType);
  if (opts.grant !== false && roleType === 'admin') {
    await grantCrud(dbName, role.id);
  }

  const suffix = `${Date.now().toString(36)}_${++userSeq}`;
  const user = await strapi.plugin('users-permissions').service('user').add({
    username: `${username}_${suffix}`,
    email: `${username}_${suffix}@test.local`,
    password: 'TestPass123!',
    role: role.id,
    confirmed: true,
  });
  const jwt = strapi
    .plugin('users-permissions')
    .service('jwt')
    .issue({ id: user.id }) as string;
  return { user, jwt };
}

/** Server-side fixture helper: flip `verified` bypassing controller RBAC. */
export async function setCircuitVerified(dbName: string, documentId: string, verified: boolean) {
  return core(dbName).documents('api::circuit.circuit').update({
    documentId,
    // generated contentTypes.d.ts is stale (pre-rename); cast to any.
    data: { verified } as any,
  });
}

// ── Payload fixtures ────────────────────────────────────────────────────────

const P1 = { lat: 60.1000, lon: 30.3000 };
const P2 = { lat: 60.1001, lon: 30.3001 };
const P3 = { lat: 60.1002, lon: 30.3002 };

export const gatesClosedLoop = { start_finish: [P1, P2] };
export const gatesPointToPoint = { start: [P1, P2], finish: [P2, P3] };

export const lineString = {
  type: 'LineString',
  coordinates: [
    [30.3000, 60.1000],
    [30.3001, 60.1001],
    [30.3002, 60.1002],
  ],
};

let payloadSeq = 0;

/** Default valid circuit payload (POST /api/circuits). */
export function circuitPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      name: `Test Circuit #${++payloadSeq}`,
      layout: 'closed_loop',
      gates: gatesClosedLoop,
      route_geojson: lineString,
      country: 'FI',
      ...overrides,
    },
  };
}

/** Default valid ride payload (POST /api/rides). */
export function ridePayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ride_uid: `ride-${Date.now().toString(36)}-${++payloadSeq}`,
      name: `Test Ride #${payloadSeq}`,
      visibility: 'private',
      ...overrides,
    },
  };
}

/**
 * Build a valid waypoints_blob v2 buffer (header 48B + codec=none fixed-width
 * payload), matching src/utils/blob-codec.ts (MAGIC "TRK\x02", schema 0,
 * 42 bytes per waypoint).
 */
export function buildBlob(count = 10, sampleRateHz = 25): Buffer {
  const payload = crypto.randomBytes(count * 42);
  const header = Buffer.alloc(48);
  header.set(Buffer.from([0x54, 0x52, 0x4b, 0x02]), 0); // "TRK\x02"
  header.writeUInt8(0, 4); // codec = none
  header.writeUInt8(0, 5); // schema = fixed_width
  header.writeUInt16LE(sampleRateHz, 6);
  header.writeUInt32LE(count, 8);
  header.writeUInt32LE(0, 12); // reserved = 0
  const sha = crypto.createHash('sha256').update(payload).digest();
  header.set(sha, 16);
  return Buffer.concat([header, payload]);
}

/** A blob with a corrupted payload (SHA-256 mismatch) for 422 tests. */
export function buildBlobBadSha(count = 10): Buffer {
  const blob = buildBlob(count);
  blob[48] = blob[48] ^ 0xff; // flip one payload byte → integrity fails
  return blob;
}

/** A gzip-compressed valid blob (codec=3) for codec coverage. */
export function buildGzipBlob(count = 10): Buffer {
  const payload = crypto.randomBytes(count * 42);
  const compressed = zlib.gzipSync(payload);
  const header = Buffer.alloc(48);
  header.set(Buffer.from([0x54, 0x52, 0x4b, 0x02]), 0);
  header.writeUInt8(3, 4); // codec = gzip
  header.writeUInt8(0, 5); // schema = fixed_width
  header.writeUInt16LE(25, 6);
  header.writeUInt32LE(count, 8);
  header.writeUInt32LE(0, 12);
  const sha = crypto.createHash('sha256').update(payload).digest();
  header.set(sha, 16);
  return Buffer.concat([header, compressed]);
}

/** Convenience: authenticated GET helper. */
export function authed(
  agent: supertest.SuperTest<supertest.Test>,
  jwt: string,
  method: 'get' | 'post' | 'put' | 'delete',
  url: string
) {
  return agent[method](url).set('Authorization', `Bearer ${jwt}`);
}
