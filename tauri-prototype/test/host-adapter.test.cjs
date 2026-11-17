const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('failed note barrier prevents config writes and resumes editing', async () => {
  const { withRestartBarrier } = await import('../host/helper-adapter.mjs');
  const calls = [];
  const helper = { async control(action) { calls.push(action); if (action === 'flush') throw Error('disk full'); } };
  const result = await withRestartBarrier(['/dsh-pet-7340/config','PUT'], () => { calls.push('write'); }, () => helper, async () => {});
  assert.equal(result.status, 503);
  assert.deepEqual(calls, ['flush','resume']);
});

test('mutating routes wait for save and restart; public reads remain independent', async () => {
  const { withRestartBarrier } = await import('../host/helper-adapter.mjs');
  for (const route of ['config','%63onfig','reload','pet-display']) {
    const calls = [];
    const helper = { async control(action) { calls.push(action); } };
    await withRestartBarrier(['/dsh-pet-7340/'+route,'POST'], async () => { calls.push('write'); return {status:200}; }, () => helper, async () => { calls.push('restart'); });
    assert.deepEqual(calls, ['flush','write','restart','resume']);
  }
});

test('late bridge replies cannot reach a replacement helper', async () => {
  const { withTauriHelper } = await import('../host/helper-adapter.mjs');
  let resolve;
  const writes=[];
  class Base { constructor() { this.options={bridgeHandler:()=>new Promise(r=>resolve=r)}; } }
  const helper = new (withTauriHelper(Base))();
  helper.child={exitCode:null,stdin:{destroyed:false,write:v=>writes.push(v)}};
  const waiting=helper.handleBridgeLine('dsh-pet-bridge:{"id":1,"url":"/state"}');
  helper.child={exitCode:null,stdin:{destroyed:false,write:v=>writes.push(v)}};
  resolve({id:1,status:200,body:'old'});await waiting;
  assert.deepEqual(writes,[]);
});
