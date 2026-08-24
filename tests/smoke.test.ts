/**
 * Boot probe — validates the whole harness (Strapi load + mount + supertest +
 * seeds + JWT) before the full suite relies on it.
 */

import {
  bootStrapi,
  shutdownStrapi,
  request,
  createUser,
  circuitPayload,
} from './helpers';

const DB = 'smoke';

describe('harness smoke', () => {
  beforeAll(async () => {
    await bootStrapi(DB);
  });

  afterAll(async () => {
    await shutdownStrapi(DB);
  });

  it('serves the content API and public circuit routes are reachable', async () => {
    const res = await request(DB).get('/api/circuits').expect(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('pagination');
  });

  it('authenticated user can create a circuit and read it back', async () => {
    const { jwt } = await createUser(DB, 'smoke_user');
    const create = await request(DB)
      .post('/api/circuits')
      .set('Authorization', `Bearer ${jwt}`)
      .send(circuitPayload())
      .expect(201);
    const documentId = create.body.data.documentId;
    expect(documentId).toBeTruthy();

    const read = await request(DB).get(`/api/circuits/${documentId}`);
    expect(read.status).toBe(403); // draft (unverified) is invisible to guests

    const own = await request(DB)
      .get(`/api/circuits/${documentId}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
    expect(own.body.data.documentId).toBe(documentId);
  });
});
