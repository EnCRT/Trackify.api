/**
 * GET /api/profiles/me/stats — live Home-statistics aggregate (P2).
 *
 * Verifies: auth requirement, empty-user shape, aggregation over own rides
 * only, soft-delete exclusion, and that max/best/first/last extremes are right.
 */

import {
  bootStrapi,
  shutdownStrapi,
  request,
  createUser,
  ridePayload,
  authed,
} from './helpers';

const DB = 'profiles-stats';

const EMPTY = {
  total_distance_m: 0,
  total_time_ms: 0,
  rides_count: 0,
  max_speed_mps: null,
  best_lap_ms: null,
  first_ride_at: null,
  last_ride_at: null,
};

describe('GET /api/profiles/me/stats', () => {
  beforeAll(async () => {
    await bootStrapi(DB);
  });

  afterAll(async () => {
    await shutdownStrapi(DB);
  });

  it('returns 401 without a Bearer token', async () => {
    await request(DB).get('/api/profiles/me/stats').expect(401);
  });

  it('returns 401 with a garbage token', async () => {
    await authed(request(DB), 'not-a-jwt', 'get', '/api/profiles/me/stats').expect(401);
  });

  it('returns the empty aggregate for a user with no rides', async () => {
    const { jwt } = await createUser(DB, 'stats_empty');
    const res = await authed(request(DB), jwt, 'get', '/api/profiles/me/stats').expect(200);
    expect(res.body.data).toEqual(EMPTY);
  });

  it('aggregates only the caller’s non-deleted rides', async () => {
    const owner = await createUser(DB, 'stats_owner');
    const other = await createUser(DB, 'stats_other');

    const postRide = async (jwt: string, overrides: Record<string, unknown>) => {
      const res = await request(DB)
        .post('/api/rides')
        .set('Authorization', `Bearer ${jwt}`)
        .send(ridePayload(overrides))
        .expect(201);
      return res.body.data;
    };

    // Owner's rides — one of them (short) gets soft-deleted below.
    await postRide(owner.jwt, {
      total_distance_m: 1000,
      duration_ms: 60000,
      max_speed_mps: 30,
      best_lap_ms: 50000,
      start_time: '2026-08-01T10:00:00.000Z',
    });
    await postRide(owner.jwt, {
      total_distance_m: 2000,
      duration_ms: 120000,
      max_speed_mps: 45,
      best_lap_ms: 40000,
      start_time: '2026-08-05T10:00:00.000Z',
    });
    const doomed = await postRide(owner.jwt, {
      total_distance_m: 500,
      duration_ms: 30000,
      max_speed_mps: 20,
      best_lap_ms: null,
      start_time: '2026-08-03T10:00:00.000Z',
    });

    // Another user's ride — must not leak into the aggregate.
    await postRide(other.jwt, {
      total_distance_m: 99999,
      duration_ms: 999999,
      max_speed_mps: 99,
      best_lap_ms: 1000,
      start_time: '2020-01-01T00:00:00.000Z',
    });

    // Soft-delete the owner's short ride → excluded from the aggregate.
    await authed(request(DB), owner.jwt, 'delete', `/api/rides/${doomed.documentId}`).expect(200);

    const res = await authed(request(DB), owner.jwt, 'get', '/api/profiles/me/stats').expect(200);
    expect(res.body.data).toEqual({
      total_distance_m: 3000,
      total_time_ms: 180000,
      rides_count: 2,
      max_speed_mps: 45,
      best_lap_ms: 40000,
      first_ride_at: '2026-08-01T10:00:00.000Z',
      last_ride_at: '2026-08-05T10:00:00.000Z',
    });
  });

  it('stats work without a Profile row (ride-only user)', async () => {
    const { jwt } = await createUser(DB, 'stats_noprofile');
    await request(DB)
      .post('/api/rides')
      .set('Authorization', `Bearer ${jwt}`)
      .send(
        ridePayload({
          total_distance_m: 750,
          duration_ms: 90000,
          max_speed_mps: 22,
          start_time: '2026-08-10T12:00:00.000Z',
        })
      )
      .expect(201);

    const res = await authed(request(DB), jwt, 'get', '/api/profiles/me/stats').expect(200);
    expect(res.body.data).toMatchObject({
      total_distance_m: 750,
      total_time_ms: 90000,
      rides_count: 1,
      max_speed_mps: 22,
      first_ride_at: '2026-08-10T12:00:00.000Z',
      last_ride_at: '2026-08-10T12:00:00.000Z',
    });
  });
});
