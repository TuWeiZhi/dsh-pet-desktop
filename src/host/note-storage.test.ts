import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NoteStore } = require('../../runtime/electron-helper/note-storage.js');
const { NoteSaver } = require('../../runtime/electron-helper/note-saving.js');
const fs = require('node:fs/promises');

test('migrates once, accepts long text, preserves per-pet data and clearing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pet-notes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new NoteStore(dir);
  assert.equal(await store.read('main'), null);
  assert.equal(await store.read('main', '旧便签'), '旧便签');
  const long = '长便签\n'.repeat(25000);
  await store.write('main', long);
  assert.equal(await store.read('main', '旧便签'), long);
  await store.write('other', '另一只');
  await store.write('main', '');
  assert.equal(await new NoteStore(dir).read('main', '旧便签'), '');
  assert.equal(await store.read('other'), '另一只');
});

test('writes to one note are serialized and reads await the latest write', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pet-notes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new NoteStore(dir);
  const jobs = ['first', 'second', 'final'].map(text => store.write('../same-key', text));
  assert.equal(await store.read('../same-key'), 'final');
  await Promise.all(jobs);
});

test('continuous input is coalesced and flush bypasses the debounce delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const saver = new NoteSaver(async text => { writes.push(text); });
  saver.schedule('a');
  t.mock.timers.tick(300);
  saver.schedule('ab');
  t.mock.timers.tick(300);
  assert.deepEqual(writes, []);
  await saver.flush();
  assert.deepEqual(writes, ['ab']);
  t.mock.timers.tick(2000);
  assert.deepEqual(writes, ['ab']);
});

test('nonstop typing saves within the max wait instead of deferring forever', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const saver = new NoteSaver(async text => { writes.push(text); });
  for (let i = 0; i < 7; i++) { saver.schedule(String(i)); t.mock.timers.tick(300); }
  await Promise.resolve();
  assert.deepEqual(writes, ['6']);
  await saver.flush();
});

test('an in-flight save cannot overwrite later edits', async () => {
  const writes = [];
  let finish;
  const saver = new NoteSaver(text => {
    writes.push(text);
    return writes.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
  });
  saver.schedule('old');
  const flushing = saver.flush();
  await Promise.resolve();
  saver.schedule('new');
  finish();
  await flushing;
  assert.deepEqual(writes, ['old', 'new']);
});

test('a failed save keeps the latest draft for a later retry', async () => {
  let fail = true;
  const writes = [];
  const saver = new NoteSaver(async text => { if (fail) throw new Error('disk full'); writes.push(text); });
  saver.schedule('draft');
  await assert.rejects(saver.flush(), /disk full/);
  fail = false;
  await saver.flush();
  assert.deepEqual(writes, ['draft']);
});

test('a failed replacement leaves the previous file intact and can be retried', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pet-notes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new NoteStore(dir);
  await store.write('main', 'previous');
  t.mock.method(fs, 'rename', async () => { throw new Error('disk full'); });
  await assert.rejects(store.write('main', 'latest'), /disk full/);
  assert.equal(await store.read('main'), 'previous');
  await assert.rejects(store.flush(), /disk full/);
  t.mock.restoreAll();
  await store.write('main', 'latest');
  await store.flush();
  assert.equal(await store.read('main'), 'latest');
});

test('a failed older write never replaces a more recent pending draft', async () => {
  let reject;
  const writes = [];
  const saver = new NoteSaver(text => {
    writes.push(text);
    return writes.length === 1 ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve();
  });
  saver.schedule('old');
  const first = saver.flush();
  await Promise.resolve();
  saver.schedule('new');
  reject(new Error('write failed'));
  await assert.rejects(first, /write failed/);
  await saver.flush();
  assert.deepEqual(writes, ['old', 'new']);
});

test('undoing to saved text after a failure confirms the file and clears the exit error', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pet-notes-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new NoteStore(dir);
  await store.write('main', 'A');
  const saver = new NoteSaver(text => store.write('main', text));
  saver.saved = 'A';
  t.mock.method(fs, 'rename', async () => { throw new Error('temporarily full'); });
  saver.schedule('B');
  await assert.rejects(saver.flush(), /temporarily full/);
  t.mock.restoreAll();
  saver.schedule('A');
  await saver.flush();
  await store.flush();
  assert.equal(await store.read('main'), 'A');
});
