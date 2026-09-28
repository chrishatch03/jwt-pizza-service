const request = require('supertest');
const app = require('../service');
const { DB } = require('../database/database.js');
const { randomName, registerUser, createAdminUser, loginUser } = require('./testUtils.js');

let admin;
let adminToken;
let franchise;
let store;

beforeAll(async () => {
  admin = await createAdminUser();
  adminToken = await loginUser(admin);
  franchise = await DB.createFranchise({ name: randomName(), admins: [{ email: admin.email }] });
  store = await DB.createStore(franchise.id, { name: randomName() });
});

afterEach(() => {
  delete global.fetch;
});

test('get menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('non-admin cannot add a menu item', async () => {
  const user = await registerUser();

  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ title: randomName(), description: 'nope', image: 'x.png', price: 0.01 });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to add menu item');
});

test('admin can add a menu item', async () => {
  const item = { title: randomName(), description: 'tasty', image: 'pizza9.png', price: 0.0001 };

  const res = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminToken}`).send(item);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ title: item.title })]));
});

test('create an order and read it back', async () => {
  const user = await registerUser();

  // The service posts to the JWT Pizza Factory. Mock it so tests stay offline.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ jwt: 'factory.jwt.token', reportUrl: 'http://report' }),
  });

  const order = { franchiseId: franchise.id, storeId: store.id, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] };
  const createRes = await request(app).post('/api/order').set('Authorization', `Bearer ${user.token}`).send(order);

  expect(createRes.status).toBe(200);
  expect(createRes.body.jwt).toBe('factory.jwt.token');
  expect(createRes.body.order).toMatchObject({ franchiseId: franchise.id, storeId: store.id });
  expect(global.fetch).toHaveBeenCalled();

  const getRes = await request(app).get('/api/order').set('Authorization', `Bearer ${user.token}`);
  expect(getRes.status).toBe(200);
  expect(getRes.body.dinerId).toBe(user.id);
  expect(getRes.body.orders.length).toBe(1);
});

test('order fails when the factory rejects it', async () => {
  const user = await registerUser();

  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({ reportUrl: 'http://report' }),
  });

  const order = { franchiseId: franchise.id, storeId: store.id, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] };
  const res = await request(app).post('/api/order').set('Authorization', `Bearer ${user.token}`).send(order);

  expect(res.status).toBe(500);
  expect(res.body.message).toBe('Failed to fulfill order at factory');
});

test('creating an order requires authentication', async () => {
  const res = await request(app).post('/api/order').send({ franchiseId: 1, storeId: 1, items: [] });
  expect(res.status).toBe(401);
});
