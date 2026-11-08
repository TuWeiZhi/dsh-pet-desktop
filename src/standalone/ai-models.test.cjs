const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { runInNewContext } = require('node:vm');
const { createServer } = require('node:http');
const { Readable } = require('node:stream');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { z } = require('zod');

const bundle = readFileSync(join(__dirname, '../../lib/standalone.js'), 'utf8');
function region(name) {
  const start = bundle.indexOf('//#region src/standalone/' + name + '.ts');
  assert.ok(start >= 0);
  const end = bundle.indexOf('//#endregion', start);
  const next = bundle.indexOf('//#region ', start + 1);
  return bundle.slice(start, next < 0 ? end : Math.min(end, next));
}
const globals = { z, URL, Headers, AbortController, setTimeout, clearTimeout };
const { validateSettings, DEFAULT_AI_SETTINGS } = runInNewContext(
  region('ai-config') + '\n({ validateSettings, DEFAULT_AI_SETTINGS })', globals,
);
const source = stripTypeScriptTypes(readFileSync(join(__dirname, 'ai-models.ts'), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
const settings = { ...DEFAULT_AI_SETTINGS, baseUrl: 'https://example.test/v1', apiKey: 'saved-key', model: 'saved-model' };
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

for (const [label, code] of [['source', source], ['desktop release', region('ai-models')]]) {
  const discover = runInNewContext(code + '\nfetchAvailableModels', { ...globals, validateSettings });
  test(label + ': fetches unsaved connection models, reuses saved key and leaves settings unchanged', async () => {
    let calls = 0;
    const result = await discover({ baseUrl: 'https://other.test/api/v1/', apiKey: '' }, settings, async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://other.test/api/v1/models');
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.get('authorization'), 'Bearer saved-key');
      assert.equal(init.redirect, 'error');
      return json({ data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }, {}, { id: '' }, { id: 123 }] });
    });
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(result.models), JSON.stringify([{ id: 'a', name: 'a' }, { id: 'z', name: 'z' }]));
    assert.equal(calls, 1);
    assert.equal(settings.baseUrl, 'https://example.test/v1');
    assert.equal(settings.model, 'saved-model');
    assert.equal(JSON.stringify(result).includes('saved-key'), false);
  });

  test(label + ': Anthropic auth, root or v1 base URL, display names and pagination', async () => {
    for (const baseUrl of ['https://example.test', 'https://example.test/v1/']) {
      let calls = 0;
      const result = await discover({ protocol: 'anthropic', baseUrl, apiKey: 'fresh-key' }, settings, async (url, init) => {
        calls++;
        assert.equal(url.pathname, '/v1/models');
        assert.equal(init.headers.get('x-api-key'), 'fresh-key');
        assert.equal(init.headers.get('anthropic-version'), '2023-06-01');
        assert.equal(init.headers.get('authorization'), null);
        if (calls === 1) return json({ data: [{ id: 'one', display_name: 'Model One' }], has_more: true, last_id: 'one' });
        assert.equal(url.searchParams.get('after_id'), 'one');
        return json({ data: [{ id: 'two' }], has_more: false });
      });
      assert.equal(result.models.length, 2);
      assert.equal(result.models[0].name, 'Model One');
      assert.equal(calls, 2);
    }
  });

  test(label + ': rejects invalid inputs and clearing the key before making a request', async () => {
    for (const input of [null, [], { baseUrl: 'file:///tmp' }, { apiKey: 123 }, { clearApiKey: true }, { baseUrl: '' }]) {
      const result = await discover(input, settings, async () => assert.fail('must not request'));
      assert.equal(result.ok, false);
    }
  });

  test(label + ': reports empty, malformed, denied and failed responses without exposing response secrets', async () => {
    const empty = await discover({}, settings, async () => json({ data: [] }));
    assert.equal(empty.ok, true);
    assert.equal(empty.models.length, 0);
    for (const status of [401, 403, 404, 429, 500]) {
      const result = await discover({}, settings, async () => new Response('private-provider-error', { status }));
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes('private-provider-error'), false);
    }
    for (const body of [{ models: [] }, { data: [], has_more: true }, { data: [], has_more: true, last_id: 'same' }]) {
      const result = await discover({ protocol: 'anthropic' }, settings, async () => json(body));
      assert.equal(result.ok, false);
    }
    const failed = await discover({}, settings, async () => { throw new Error('private-key'); });
    assert.equal(failed.ok, false);
    assert.equal(failed.message.includes('private-key'), false);
  });
}

test('desktop model route requires authentication and uses POST without saving connection fields', async () => {
  const code = ['request-security', 'request-body', 'settings', 'settings-page', 'server'].map(region).join('\n');
  const { listenStandaloneServer, createRequestSecurity } = runInNewContext(code + '\n({ listenStandaloneServer, createRequestSecurity })', {
    ...globals, Buffer, Readable, createServer, randomBytes, timingSafeEqual, queueMicrotask,
  });
  const security = createRequestSecurity();
  const requests = [];
  const server = await listenStandaloneServer({ port: 0, security, routes: [],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    ai: { saveSettings() { assert.fail('must not save'); }, async fetchModels(input) {
      requests.push(input);
      return { ok: true, models: [{ id: 'available', name: 'Available' }] };
    } },
  });
  const url = `http://127.0.0.1:${server.port}/standalone-ai/models`;
  try {
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
    const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(url, { headers })).status, 405);
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ baseUrl: 'https://example.test', apiKey: 'new-key' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).models[0].id, 'available');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].apiKey, 'new-key');
    assert.equal((await fetch(url, { method: 'POST', headers, body: 'broken' })).status, 400);
  } finally { await server.close(); }
});
