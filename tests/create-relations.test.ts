/**
 * P0 regression: POST device / event / motorcycle / sync-session must succeed
 * (201) for an authenticated user — the owner relation must NOT be injected
 * into ctx.request.body.data, or Strapi 5's input validation
 * (throwRestrictedRelations) rejects the create with 400 "Invalid key".
 *
 * Each fixed controller connects the plugin::users-permissions.user relation
 * AFTER create via the document service, so the POST response itself must
 * carry the populated owner (the controller refetches with populate and
 * returns the entity manually, bypassing sanitizeOutput).
 */

import {
  bootStrapi,
  shutdownStrapi,
  request,
  core,
  createUser,
  authed,
} from './helpers';

const DB = 'create-relations';

describe('POST create — owner relation (no 400)', () => {
  beforeAll(async () => {
    await bootStrapi(DB);
  });

  afterAll(async () => {
    await shutdownStrapi(DB);
  });

  it('POST /api/devices → 201, owner relation set on the response', async () => {
    const { jwt, user } = await createUser(DB, 'dev_user');
    const res = await authed(request(DB), jwt, 'post', '/api/devices')
      .send({ data: { name: 'Trackify Tracker', serial_number: `SN-${Date.now().toString(36)}` } })
      .expect(201);
    const documentId = res.body.data.documentId;
    expect(documentId).toBeTruthy();
    expect(res.body.data.user?.id).toBe(user.id);

    // Relation is truly persisted: document-service findOne with populate.
    const persisted = await core(DB)
      .documents('api::device.device')
      .findOne({ documentId, populate: ['user'] });
    expect((persisted as any).user?.id).toBe(user.id);
  });

  it('device re-pair by serial → 200 with owner; orphan device self-heals', async () => {
    const { jwt, user } = await createUser(DB, 'dev_repair');
    const serial = `SN-REPAIR-${Date.now().toString(36)}`;

    const first = await authed(request(DB), jwt, 'post', '/api/devices')
      .send({ data: { name: 'Tracker', serial_number: serial } })
      .expect(201);
    const documentId = first.body.data.documentId;
    expect(first.body.data.user?.id).toBe(user.id);

    // Same serial again (same user) → 200, same record, no duplicate.
    const second = await authed(request(DB), jwt, 'post', '/api/devices')
      .send({ data: { name: 'Tracker (re-pair)', serial_number: serial } })
      .expect(200);
    expect(second.body.data.documentId).toBe(documentId);
    expect(second.body.data.user?.id).toBe(user.id);

    // Self-heal: strip the owner server-side (simulates a create that died
    // between create and owner-link), then re-pair → owner reconnected.
    await core(DB).documents('api::device.device').update({
      documentId,
      data: { user: null } as any,
    });
    const healed = await authed(request(DB), jwt, 'post', '/api/devices')
      .send({ data: { name: 'Tracker', serial_number: serial } })
      .expect(200);
    expect(healed.body.data.documentId).toBe(documentId);
    expect(healed.body.data.user?.id).toBe(user.id);
  });

  it('device re-pair by another user → 403 (serial is globally unique)', async () => {
    const owner = await createUser(DB, 'dev_owner');
    const thief = await createUser(DB, 'dev_thief');
    const serial = `SN-OWNED-${Date.now().toString(36)}`;

    await authed(request(DB), owner.jwt, 'post', '/api/devices')
      .send({ data: { name: 'Owned', serial_number: serial } })
      .expect(201);

    await authed(request(DB), thief.jwt, 'post', '/api/devices')
      .send({ data: { name: 'Mine now', serial_number: serial } })
      .expect(403);
  });

  it('POST /api/events → 201, organizer relation set on the response', async () => {
    const { jwt, user } = await createUser(DB, 'evt_user');
    const res = await authed(request(DB), jwt, 'post', '/api/events')
      .send({ data: { name: 'Track Day', date: '2026-09-01T09:00:00.000Z' } })
      .expect(201);
    const documentId = res.body.data.documentId;
    expect(documentId).toBeTruthy();
    expect(res.body.data.organizer?.id).toBe(user.id);

    const persisted = await core(DB)
      .documents('api::event.event')
      .findOne({ documentId, populate: ['organizer'] });
    expect((persisted as any).organizer?.id).toBe(user.id);
  });

  it('POST /api/motorcycles → 201, owner relation set on the response', async () => {
    const { jwt, user } = await createUser(DB, 'moto_user');
    const res = await authed(request(DB), jwt, 'post', '/api/motorcycles')
      .send({ data: { name: 'Yamaha R6', kind: 'moto' } })
      .expect(201);
    const documentId = res.body.data.documentId;
    expect(documentId).toBeTruthy();
    expect(res.body.data.user?.id).toBe(user.id);

    // Ownership checks in findOne/update/delete read the relation through the
    // document service — GET as the owner must still pass the ownership gate.
    await authed(request(DB), jwt, 'get', `/api/motorcycles/${documentId}`).expect(200);

    const persisted = await core(DB)
      .documents('api::motorcycle.motorcycle')
      .findOne({ documentId, populate: ['user'] });
    expect((persisted as any).user?.id).toBe(user.id);
  });

  it('POST /api/sync-sessions → 201, owner relation set on the response', async () => {
    const { jwt, user } = await createUser(DB, 'sync_user');
    const res = await authed(request(DB), jwt, 'post', '/api/sync-sessions')
      .send({ data: { transport: 'ble' } })
      .expect(201);
    const documentId = res.body.data.documentId;
    expect(documentId).toBeTruthy();
    expect(res.body.data.user?.id).toBe(user.id);

    const persisted = await core(DB)
      .documents('api::sync-session.sync-session')
      .findOne({ documentId, populate: ['user'] });
    expect((persisted as any).user?.id).toBe(user.id);
  });

  it('no 400 "Invalid key" leakage — bodies without relations stay clean', async () => {
    // Sanity: after the four creates above, no request body was polluted with
    // a plugin::users-permissions.user relation key. A fresh motorcycle create
    // without any relation keys must succeed and never hit throwRestrictedRelations.
    const { jwt } = await createUser(DB, 'moto_clean');
    const res = await authed(request(DB), jwt, 'post', '/api/motorcycles')
      .send({ data: { name: 'Honda CBR', kind: 'moto' } })
      .expect(201);
    expect(res.body.data.documentId).toBeTruthy();
  });
});
