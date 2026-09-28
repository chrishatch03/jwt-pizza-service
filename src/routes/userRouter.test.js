const request = require('supertest');
const app = require('../service');
const { randomName, registerUser } = require('./testUtils.js');

test('get authenticated user', async () => {
  const user = await registerUser();

  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${user.token}`);
  expect(res.status).toBe(200);
  expect(res.body.email).toBe(user.email);
  expect(res.body.roles).toMatchObject([{ role: 'diner' }]);
});

test('get me without a token is unauthorized', async () => {
  const res = await request(app).get('/api/user/me');
  expect(res.status).toBe(401);
});

test('user can update their own name', async () => {
  const user = await registerUser();
  const newName = randomName();

  const res = await request(app)
    .put(`/api/user/${user.id}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ name: newName, email: user.email, password: user.password });

  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe(newName);
  expect(res.body.token).toBeDefined();
});

test('user cannot update a different user', async () => {
  const user = await registerUser();
  const other = await registerUser();

  const res = await request(app)
    .put(`/api/user/${other.id}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ name: randomName() });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('delete and list users are not implemented', async () => {
  const user = await registerUser();

  const deleteRes = await request(app).delete(`/api/user/${user.id}`).set('Authorization', `Bearer ${user.token}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('not implemented');

  const listRes = await request(app).get('/api/user').set('Authorization', `Bearer ${user.token}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body.users).toEqual([]);
});
