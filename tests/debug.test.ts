import { bootStrapi, shutdownStrapi, request, createUser, circuitPayload } from './helpers';
const DB = 'debug';
describe('debug', () => {
  beforeAll(async () => { await bootStrapi(DB); });
  afterAll(async () => { await shutdownStrapi(DB); });
  it('shows error body', async () => {
    const { jwt } = await createUser(DB, 'dbg_user');
    const res = await request(DB)
      .post('/api/circuits')
      .set('Authorization', `Bearer ${jwt}`)
      .send(circuitPayload());
    console.log('STATUS', res.status);
    console.log(JSON.stringify(res.body, null, 2).slice(0, 2000));
  });
});
