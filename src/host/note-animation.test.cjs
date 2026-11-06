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

function noteFixture(pageLines = 5) {
  const clips = [];
  const note = Object.create(PetNote.prototype);
  Object.assign(note, {
    loaded: true, isOpen: true, composing: false, page: 0, targetPage: 0,
    pageTurning: false, pageTurnToken: 0, pageLines,
    text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np',
    input: { value: '' }, prev: {}, next: {}, pageNumber: {},
    el: { hidden: false, contains: () => false },
    saver: { schedule() {} },
    repaginate(offset) {
      this.pages = pages.paginate(this.text, 20, () => 1, this.pageLines);
      this.page = pages.pageAt(this.pages, offset);
      this.renderPage();
    },
    onPage(direction, done) { clips.push({ direction, done }); },
    clearTimers() {}, captureComposition() {}, flush: async () => {}, onChange() {},
  });
  note.pages = pages.paginate(note.text, 20, () => 1, note.pageLines);
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

test('the editor follows the actual paper dimensions even for a small pet', () => {
  for (const height of [29, 72, 112, 194]) {
    const note = Object.create(PetNote.prototype);
    const card = { x: 200, y: 350, w: height * 306 / 155, h: height };
    note.isOpen = true;
    note.el = { style: {}, dataset: {} };
    note.controls = { offsetHeight: 22, offsetWidth: Math.max(76, card.w) };
    note.getLayout = () => ({ card, bounds: { x: 0, y: 0, w: 900, h: 780 } });
    note.place();
    assert.equal(parseFloat(note.el.style.width), card.w);
    assert.equal(parseFloat(note.el.style.height), card.h);
    assert.equal(parseFloat(note.el.style.top), card.y);
  }
});

test('a full last page can extend at every measured line capacity', () => {
  for (const capacity of [1, 3, 6, 11]) {
    const { note, clips } = noteFixture(capacity);
    note.text = Array.from({ length: capacity }, () => 'x').join('\n');
    const original = note.text;
    note.repaginate(0);
    assert.equal(note.next.disabled, false, `${capacity} lines fills the page`);
    note.changePage(1);
    note.changePage(1);
    clips[0].done();
    assert.equal(note.page, 1);
    assert.equal(note.text, original + '\n');
    assert.equal(note.next.disabled, true);
    assert.equal(clips.length, 1);
  }
});

test('paper and its footer remain visible at each screen corner without changing paper size', () => {
  for (const x of [-100, 1000]) for (const y of [-100, 1000]) {
    const note = Object.create(PetNote.prototype);
    const card = { x, y, w: 57, h: 29 };
    note.isOpen = true;
    note.el = { style: {} };
    note.controls = { offsetWidth: 76, offsetHeight: 22 };
    note.getLayout = () => ({ card, bounds: { x: 0, y: 0, w: 400, h: 430 } });
    note.place();
    const left = parseFloat(note.el.style.left), top = parseFloat(note.el.style.top);
    assert.ok(left - 9.5 >= 0 && left + 57 + 9.5 <= 400);
    assert.ok(top >= 0 && top + 29 + 22 <= 430);
    assert.equal(parseFloat(note.el.style.width), 57);
    assert.equal(parseFloat(note.el.style.height), 29);
  }
});

test('repagination measures complete rows and retains the reading position as paper size changes', () => {
  const { note } = noteFixture();
  delete note.repaginate;
  note.text = Array.from({ length: 30 }, () => 'x').join('\n');
  note.input.clientWidth = 100;
  let height = 17;
  note.input.getBoundingClientRect = () => ({ height });
  note.measureContext = { measureText: () => ({ width: 1 }) };
  global.window = { PetNotePages: pages };
  global.document = { activeElement: null };
  global.getComputedStyle = () => ({ font: '12px/16px sans-serif', lineHeight: '16px',
    paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' });
  try {
    for (const [pixels, capacity] of [[17, 1], [60, 3], [95.9, 5], [100, 6], [180, 11]]) {
      height = pixels;
      note.repaginate(0);
      assert.equal(note.pageLines, capacity);
      assert.ok(note.pages.every(page => page.lines <= capacity));
      assert.equal(note.pages.map(page => note.text.slice(page.start, page.end)).join(''), note.text);
    }
    height = 100;
    note.repaginate(0);
    note.page = 2;
    const position = note.pages[note.page].start;
    height = 17;
    note.repaginate();
    assert.equal(note.pages[note.page].start, position);
  } finally {
    delete global.window; delete global.document; delete global.getComputedStyle;
  }
});
