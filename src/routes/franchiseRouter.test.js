const request = require('supertest');
const app = require('../service');
const { randomName, registerUser, createAdminUser, loginUser } = require('./testUtils.js');

let admin;
let adminToken;

beforeAll(async () => {
  admin = await createAdminUser();
  adminToken = await loginUser(admin);
});

async function createFranchise(adminEmail = admin.email) {
  const name = randomName();
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, admins: [{ email: adminEmail }] });
  return res;
}

test('admin can create a franchise', async () => {
  const res = await createFranchise();
  expect(res.status).toBe(200);
  expect(res.body.id).toBeDefined();
  expect(res.body.admins[0].email).toBe(admin.email);
});

test('non-admin cannot create a franchise', async () => {
  const user = await registerUser();
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ name: randomName(), admins: [{ email: user.email }] });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a franchise');
});

test('creating a franchise for an unknown admin fails', async () => {
  const res = await createFranchise(randomName() + '@nobody.com');
  expect(res.status).toBe(404);
});

test('list franchises', async () => {
  await createFranchise();
  const res = await request(app).get('/api/franchise?page=0&limit=10&name=*');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.franchises)).toBe(true);
});

test("list a user's own franchises", async () => {
  const created = await createFranchise();

  const res = await request(app).get(`/api/franchise/${admin.id}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.some((f) => f.id === created.body.id)).toBe(true);
});

test("a user cannot list another user's franchises", async () => {
  const user = await registerUser();
  const res = await request(app).get(`/api/franchise/${admin.id}`).set('Authorization', `Bearer ${user.token}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('admin can create and delete a store', async () => {
  const franchise = (await createFranchise()).body;

  const createRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ franchiseId: franchise.id, name: randomName() });
  expect(createRes.status).toBe(200);
  expect(createRes.body.id).toBeDefined();

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${createRes.body.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('store deleted');
});

test('a stranger cannot create a store', async () => {
  const franchise = (await createFranchise()).body;
  const user = await registerUser();

  const res = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ franchiseId: franchise.id, name: randomName() });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a store');
});

test('a stranger cannot delete a store', async () => {
  const franchise = (await createFranchise()).body;
  const user = await registerUser();

  const store = (
    await request(app)
      .post(`/api/franchise/${franchise.id}/store`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ franchiseId: franchise.id, name: randomName() })
  ).body;

  const res = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${store.id}`)
    .set('Authorization', `Bearer ${user.token}`);

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to delete a store');
});

test('delete a franchise', async () => {
  const franchise = (await createFranchise()).body;

  const res = await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');
});
