const request = require('supertest');
const app = require('../service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}
function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function registerUser() {
  const user = { name: randomName(), email: randomName() + '@test.com', password: 'a' };
  const res = await request(app).post('/api/auth').send(user);
  return { ...user, id: res.body.user.id, token: res.body.token };
}

test('register requires name, email, and password', async () => {
  const res = await request(app).post('/api/auth').send({ name: 'no password' });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('name, email, and password are required');
});

test('login with bad password fails', async () => {
  const res = await request(app).put('/api/auth').send({ email: testUser.email, password: 'wrong' });
  expect(res.status).toBe(404);
});

test('logout succeeds and invalidates the token', async () => {
  const user = await registerUser();

  const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${user.token}`);
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body.message).toBe('logout successful');

  const afterRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${user.token}`);
  expect(afterRes.status).toBe(401);
});

test('logout without a token is unauthorized', async () => {
  const res = await request(app).delete('/api/auth');
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});
