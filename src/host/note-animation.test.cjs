const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PetNote } = require('../../runtime/electron-helper/note.js');
const pages = require('../../runtime/electron-helper/note-pages.js');

const context = { console, navigator: { platform: 'Win32' }, window: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../runtime/electron-helper/note-media-data.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../runtime/electron-helper/sprite.js'), 'utf8') + '\nthis.PetSprite = PetSprite;', context);

function noteFixture() {
  const clips = [];
  const note = Object.create(PetNote.prototype);
  Object.assign(note, {
    loaded: true, isOpen: true, composing: false, page: 0, targetPage: 0,
    pageTurning: false, pageTurnToken: 0,
    text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np',
    input: { value: '' }, prev: {}, next: {}, pageNumber: {},
    el: { hidden: false, contains: () => false },
    saver: { schedule() {} },
    repaginate(offset) {
      this.pages = pages.paginate(this.text, 20, () => 1);
      this.page = pages.pageAt(this.pages, offset);
      this.renderPage();
    },
    onPage(direction, done) { clips.push({ direction, done }); },
    clearTimers() {}, captureComposition() {}, flush: async () => {}, onChange() {},
  });
  note.pages = pages.paginate(note.text, 20, () => 1);
  note.renderPage();
  return { note, clips };
}

test('rapid forward clicks advance one page per completed animation', () => {
  const { note, clips } = noteFixture();
  note.changePage(1);
  note.changePage(1);
  note.changePage(1);
  assert.equal(note.page, 1);
  assert.equal(clips.length, 1);
  clips[0].done();
  assert.equal(note.page, 2);
  assert.equal(clips.length, 2);
  clips[1].done();
  assert.equal(note.page, 3);
  clips[2].done();
  assert.equal(note.pageTurning, false);
  assert.deepEqual(clips.map(c => c.direction), [1, 1, 1]);
});

test('reversing rapid navigation turns back to the requested page', () => {
  const { note, clips } = noteFixture();
  note.changePage(1);
  note.changePage(-1);
  clips[0].done();
  assert.equal(note.page, 0);
  clips[1].done();
  assert.deepEqual(clips.map(c => c.direction), [1, -1]);
});

test('page boundaries do not play a turn when the page cannot change', () => {
  const { note, clips } = noteFixture();
  note.changePage(-1);
  assert.equal(clips.length, 0);
  note.page = note.pages.length - 1;
  note.changePage(1);
  assert.equal(clips.length, 0);
});

test('closing cancels queued turns and invalidates the old completion', async () => {
  const { note, clips } = noteFixture();
  note.changePage(1);
  note.changePage(1);
  global.document = { activeElement: null };
  try { note.close(); } finally { delete global.document; }
  note.isOpen = true;
  clips[0].done();
  assert.equal(note.page, 1);
  assert.equal(note.pageTurning, false);
  assert.equal(clips.length, 1);
});

test('opening and idle stay at 1x while page turns and closing use 2x', () => {
  const pet = Object.create(context.PetSprite.prototype);
  pet.noteClipToken = 0;
  pet.noteFilm = { setClip() {} };
  pet.notePose = { load() {}, play: () => Promise.resolve() };
  for (const [name, speed] of [['拿出', 1], ['上一页', 2], ['下一页', 2], ['收起', 2], ['待机', 1]]) {
    pet.playNoteClip(name, name === '待机');
    assert.equal(pet.notePose.playbackRate, speed);
  }
});

test('rapid clicks past a full final page create exactly one blank page', () => {
  const { note, clips } = noteFixture();
  note.text = 'a\nb\nc\nd\ne';
  note.repaginate(0);
  note.changePage(1);
  note.changePage(1);
  note.changePage(1);
  clips[0].done();
  assert.equal(note.page, 1);
  assert.equal(note.text, 'a\nb\nc\nd\ne\n');
  assert.equal(note.pages.length, 2);
  assert.equal(clips.length, 1);
  assert.equal(note.next.disabled, true);
});

test('a failed clip and rejected play promise finish the turn only once', async () => {
  const pet = Object.create(context.PetSprite.prototype);
  pet.noteClipToken = 0;
  pet.noteFilm = { setClip() {} };
  pet.notePose = { load() {}, play: () => Promise.reject(new Error('unavailable')) };
  let completed = 0;
  pet.playNoteClip('下一页', false, () => completed++);
  pet.notePose.onerror();
  await Promise.resolve();
  assert.equal(completed, 1);
});
