import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, newId } from '../store.mjs';

test('GitHub storage commits and reads dashboards', async () => {
  const files = new Map(); let n = 0;
  const fakeFetch = async (url, opts = {}) => {
    const key = url.split('?')[0];
    if (!opts.method) {
      const f = files.get(key);
      return f ? new Response(JSON.stringify({ sha: f.sha, content: f.content })) : new Response('{}', { status: 404 });
    }
    const body = JSON.parse(opts.body);
    const f = files.get(key);
    if (f && body.sha !== f.sha) return new Response('{}', { status: 409 });
    const sha = `sha${++n}`;
    files.set(key, { sha, content: body.content });
    assert.match(opts.headers.Authorization, /^Bearer /);
    return new Response(JSON.stringify({ content: { sha } }));
  };
  const store = createStore({ GITHUB_TOKEN: 't', GITHUB_REPO: 'AnthonyIDS/IDEAS_Dashboards' }, fakeFetch);
  const id = newId();
  await store.put(id, { v: 1 });
  await Promise.all([store.put(id, { v: 2 }), store.put(id, { v: 3 })]);
  assert.deepEqual(await store.get(id), { v: 3 });
  assert.equal(store.kind, 'github');
  assert.ok([...files.keys()][0].endsWith(`/dashboards/${id}.json`));
});
