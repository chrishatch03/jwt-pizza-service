const request = require('supertest');
const app = require('../service');
const { randomName, registerUser, createAdminUser, loginUser } = require('./testUtils.js');

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


test('list users requires authentication', async () => {
  const res = await request(app).get('/api/user');
  expect(res.status).toBe(401);
});

test('a non-admin cannot list users', async () => {
  const user = await registerUser();
  const res = await request(app).get('/api/user').set('Authorization', `Bearer ${user.token}`);
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to list users');
});

test('an admin can list users', async () => {
  const admin = await createAdminUser();
  const token = await loginUser(admin);

  const res = await request(app).get('/api/user?page=0&limit=10&name=*').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(typeof res.body.more).toBe('boolean');
  expect(res.body.users[0]).toHaveProperty('email');
  expect(res.body.users[0]).toHaveProperty('roles');
});

test('listing users is paginated', async () => {
  const admin = await createAdminUser();
  const token = await loginUser(admin);

  const res = await request(app).get('/api/user?page=0&limit=1&name=*').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.users.length).toBe(1);
  expect(res.body.more).toBe(true);
});

test('listing users can be filtered by name', async () => {
  const admin = await createAdminUser();
  const token = await loginUser(admin);
  const target = await registerUser();

  const res = await request(app).get(`/api/user?page=0&limit=10&name=${target.name}`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.users.length).toBe(1);
  expect(res.body.users[0].email).toBe(target.email);
});

test('a non-admin cannot delete a user', async () => {
  const user = await registerUser();
  const victim = await registerUser();

  const res = await request(app).delete(`/api/user/${victim.id}`).set('Authorization', `Bearer ${user.token}`);
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to delete user');
});

test('an admin can delete a user', async () => {
  const admin = await createAdminUser();
  const token = await loginUser(admin);
  const victim = await registerUser();

  const res = await request(app).delete(`/api/user/${victim.id}`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('user deleted');

  // the deleted user can no longer log in
  const loginRes = await request(app).put('/api/auth').send({ email: victim.email, password: victim.password });
  expect(loginRes.status).toBe(404);
});
