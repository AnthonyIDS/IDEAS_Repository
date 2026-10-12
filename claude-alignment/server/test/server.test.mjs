import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../index.mjs';
import { createStore } from '../store.mjs';
import { answer, fakeClient } from './helpers.mjs';

async function start(env = {}, answers = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dash-'));
  const server = createServer({ env: { ALLOWED_ORIGINS: 'https://anthonyids.github.io', REVIEW_ACCESS_CODE: 'faculty-code-123', DATA_DIR: dir, ...env }, client: fakeClient(answers), store: createStore({ DATA_DIR: dir }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => server.close() };
}
const json = (method, body, headers = {}) => ({ method, headers: { 'Content-Type': 'application/json', Origin: 'https://anthonyids.github.io', ...headers }, body: body && JSON.stringify(body) });

const reviewBody = {
  objectives: [{ id: '1.1', text: 'describing the steps and principles involved in the scientific method.' }, { id: '1.2', text: 'evaluating different methods of measurement of natural phenomena.' }],
  assignment: { title: 'Historical Figures', instructions: 'Write a paragraph about the person and their contribution to geoscience. Describe observations, measurements, maps, or fossils if available in the source.' },
};

test('health reports configuration', async () => {
  const s = await start();
  const h = await (await fetch(`${s.base}/api/health`)).json();
  assert.equal(h.claudeConnected, true);
  assert.equal(h.accessCodeRequired, true);
  assert.equal(h.storage, 'disk');
  s.close();
});

test('review needs the access code and returns checked results', async () => {
  const s = await start({}, [answer(), answer()]);
  const denied = await fetch(`${s.base}/api/review`, json('POST', reviewBody));
  assert.equal(denied.status, 401);
  const ok = await fetch(`${s.base}/api/review`, json('POST', reviewBody, { 'X-Access-Code': 'faculty-code-123' }));
  assert.equal(ok.status, 200);
  const r = await ok.json();
  assert.equal(r.alignment.length, 2);
  assert.equal(r.reliability.alignmentAgreement, 100);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://anthonyids.github.io');
  s.close();
});

test('other websites cannot use the API', async () => {
  const s = await start();
  const r = await fetch(`${s.base}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  s.close();
});

test('dashboards save and resume by ID', async () => {
  const s = await start();
  const doc = { course: { code: 'ESC1000C' }, outcomes: [], assignments: [] };
  assert.equal((await fetch(`${s.base}/api/dashboards`, json('POST', doc))).status, 401);
  const created = await (await fetch(`${s.base}/api/dashboards`, json('POST', doc, { 'X-Access-Code': 'faculty-code-123' }))).json();
  assert.match(created.id, /^[a-z2-7]{24}$/);
  const put = await fetch(`${s.base}/api/dashboards/${created.id}`, json('PUT', { ...doc, course: { code: 'ESC1000C', title: 'Earth Science' } }));
  assert.equal(put.status, 200);
  const loaded = await (await fetch(`${s.base}/api/dashboards/${created.id}`)).json();
  assert.equal(loaded.course.title, 'Earth Science');
  assert.equal((await fetch(`${s.base}/api/dashboards/notarealid`)).status, 404);
  assert.equal((await fetch(`${s.base}/api/dashboards/aaaaaaaaaaaaaaaaaaaaaaaa`)).status, 404);
  s.close();
});

test('the server hosts the dashboard page', async () => {
  const s = await start();
  const r = await fetch(`${s.base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<html/);
  s.close();
});
