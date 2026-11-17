const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

function bridge(flush) {
  const calls = [];
  const window = {
    __TAURI_INTERNALS__: { async invoke(command) { calls.push(command); } },
    PetNotes: { flushAll: flush, resumeEditing() { calls.push('resume'); } },
    addEventListener() {},
  };
  runInNewContext(readFileSync(require.resolve('../bridge.js'), 'utf8'), {
    window, location: { search: '' }, URLSearchParams,
    console: { error() {} }, alert() { calls.push('alert'); },
  });
  return { api: window.__petTauri, calls };
}

test('closing one window saves once and never quits the host', async () => {
  let saved;
  const { api, calls } = bridge(() => new Promise(resolve => { saved = resolve; }));
  const first = api.closeWindowAfterSaving();
  await api.closeWindowAfterSaving();
  assert.deepEqual(calls, []);
  saved();
  await first;
  assert.deepEqual(calls, ['finish_window_close']);
});

test('failed window save keeps the draft editable and allows retry', async () => {
  let fail = true;
  const { api, calls } = bridge(async () => { if (fail) throw Error('disk full'); });
  await api.closeWindowAfterSaving();
  assert.deepEqual(calls, ['resume', 'alert']);
  fail = false;
  await api.closeWindowAfterSaving();
  assert.deepEqual(calls, ['resume', 'alert', 'finish_window_close']);
});

test('explicit app quit retains the whole-host path', async () => {
  const { api, calls } = bridge(async () => {});
  await api.closeAfterSaving();
  assert.deepEqual(calls, ['finish_close']);
});
