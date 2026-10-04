// End-to-end smoke test: boots the real app on a random port with an in-memory DB.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';

const { app } = await import('../src/app.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null;
  return { status: res.status, data };
}
const signup = async (name, role) =>
  (await call('POST', '/auth/register', { body: { name, email: `${name}@t.com`, password: 'password123', role } })).data;

let passed = 0;
const ok = (label, fn) => (fn(), console.log('  pass', label), passed++);

const org = await signup('olivia', 'organizer');
const a = await signup('asha', 'student');
const b = await signup('rohan', 'student');

assert.equal((await call('POST', '/auth/register', { body: { name: 'x y', email: 'olivia@t.com', password: 'password123' } })).status, 409);
assert.equal((await call('POST', '/auth/login', { body: { email: 'olivia@t.com', password: 'wrongpass1' } })).status, 401);
ok('auth: signup, duplicate, bad login', () => {});

assert.equal((await call('POST', '/events', { token: a.token, body: {} })).status, 403);
assert.equal((await call('POST', '/events', { token: org.token, body: { title: 'x' } })).status, 400);
const ev = (await call('POST', '/events', {
  token: org.token,
  body: { title: 'Tech Talk', description: '', venue: 'Hall A', starts_at: new Date(Date.now() + 864e5).toISOString(), capacity: 1 },
})).data;
ok('events: role check, validation, create', () => assert.ok(ev.id));

assert.equal((await call('POST', `/events/${ev.id}/register`, { token: a.token })).status, 201);
assert.equal((await call('POST', `/events/${ev.id}/register`, { token: a.token })).status, 409);
const full = await call('POST', `/events/${ev.id}/register`, { token: b.token });
ok('registration: duplicate blocked, capacity enforced', () => assert.equal(full.status, 409));

const tickets = (await call('GET', '/me/tickets', { token: a.token })).data;
ok('ticket has QR image', () => assert.match(tickets[0].qr, /^data:image\/png;base64,/));

// Pull the code out of the QR payload route by reading the DB directly (test-only).
const { default: db } = await import('../src/db.js');
const code = db.prepare('SELECT ticket_code FROM registrations').get().ticket_code;

assert.equal((await call('POST', `/events/${ev.id}/checkin`, { token: org.token, body: { code: 'nonsense-code' } })).data.result, 'invalid');
const first = await call('POST', `/events/${ev.id}/checkin`, { token: org.token, body: { code: 'PL:' + code } });
const second = await call('POST', `/events/${ev.id}/checkin`, { token: org.token, body: { code } });
ok('check-in: invalid, success, duplicate scan', () => {
  assert.equal(first.data.result, 'ok');
  assert.equal(second.status, 409);
  assert.equal(second.data.result, 'already');
});

const stats = (await call('GET', `/events/${ev.id}/analytics`, { token: org.token })).data;
ok('analytics counts', () => {
  assert.equal(stats.registered, 1);
  assert.equal(stats.checked_in, 1);
  assert.equal(stats.checkinsBySlot.length, 1);
});
assert.equal((await call('GET', `/events/${ev.id}/analytics`, { token: a.token })).status, 403);

const cert = await call('GET', `/events/${ev.id}/certificate`, { token: a.token });
ok('certificate is a PDF', () => assert.equal(cert.data.subarray(0, 4).toString(), '%PDF'));
const certId = db.prepare('SELECT cert_id FROM registrations').get().cert_id;
const v = await call('GET', `/verify/${certId}`);
ok('certificate verifies publicly', () => assert.equal(v.data.name, 'asha'));
assert.equal((await call('GET', '/verify/NOPE')).status, 404);

// Certificates need check-in
const ev2 = (await call('POST', '/events', { token: org.token, body: { title: 'Second', venue: 'Lab', starts_at: new Date(Date.now() + 864e5).toISOString(), capacity: 5 } })).data;
await call('POST', `/events/${ev2.id}/register`, { token: b.token });
const early = await call('GET', `/events/${ev2.id}/certificate`, { token: b.token });
ok('no certificate before check-in', () => assert.equal(early.status, 403));

// Volunteers and tasks
await call('POST', `/events/${ev2.id}/volunteer`, { token: b.token });
assert.equal((await call('POST', `/events/${ev2.id}/tasks`, { token: org.token, body: { title: 'Setup', assignee_id: a.user.id } })).status, 400);
const task = (await call('POST', `/events/${ev2.id}/tasks`, { token: org.token, body: { title: 'Set up chairs', assignee_id: b.user.id } })).data;
const moved = await call('PATCH', `/tasks/${task.id}`, { token: b.token, body: { status: 'doing' } });
const sneaky = await call('PATCH', `/tasks/${task.id}`, { token: b.token, body: { title: 'hacked' } });
const stranger = await call('PATCH', `/tasks/${task.id}`, { token: a.token, body: { status: 'done' } });
ok('tasks: assign, volunteer moves own task, others blocked', () => {
  assert.equal(moved.data.status, 'doing');
  assert.equal(sneaky.status, 403);
  assert.equal(stranger.status, 403);
});

server.close();
console.log(`\n${passed} checks passed`);
