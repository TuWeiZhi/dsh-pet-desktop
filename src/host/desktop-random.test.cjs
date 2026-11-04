const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let roll = 0;
const random = Object.create(Math);
random.random = () => roll;
const context = { console, Math: random, navigator: { platform: 'Win32' } };
for (const file of ['shared-core.js', 'sprite.js']) {
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../runtime/electron-helper', file), 'utf8'), context);
}
vm.runInNewContext('this.S = PetShared; this.PetSprite = PetSprite;', context);

const animations = {
  idle: ['idle'], turn: ['turn'], moves: { actions: [{ name: 'move' }] },
  clicks: ['legacy-click'],
  categories: [
    { id: 'large', weight: 1, actions: ['a', 'b', 'c'] },
    { id: 'text', weight: 99, noMirror: true, actions: ['text'] },
  ],
};

function sprite(fixed = false, facing = 'left') {
  const pet = Object.create(context.PetSprite.prototype);
  Object.assign(pet, {
    animations, weights: { idle: 90, turn: 5, move: 5 }, pet: { fixedEnabled: fixed },
    _facing: facing, anim: 'idle', actionGapTimer: null, stopMove() {},
    dragState: { active: false, dragging: false }, stopThrow() {},
    playOnce(name) { this.chosen = name; },
    tryMove(name) { this.moved = name; this.chosen = name; return name; },
  });
  return pet;
}

test('every automatic action has equal probability regardless of category size or legacy weights', () => {
  const pet = sprite();
  const counts = {};
  for (let i = 0; i < 700; i++) {
    roll = (i + 0.5) / 700;
    pet.playIdle();
    counts[pet.chosen] = (counts[pet.chosen] || 0) + 1;
  }
  assert.deepEqual(counts, { idle: 100, turn: 100, move: 100, a: 100, b: 100, c: 100, text: 100 });
  assert.equal(pet.moved, 'move', 'the selected movement is passed through without a second random draw');
});

test('clicks sample the same regular actions uniformly and bypass the automatic rest interval', () => {
  const pet = sprite();
  pet.actionGapMs = 30000;
  pet.actionRestUntil = Date.now() + 30000;
  const counts = {};
  for (let i = 0; i < 700; i++) {
    roll = (i + 0.5) / 700;
    pet.onClick({});
    counts[pet.chosen] = (counts[pet.chosen] || 0) + 1;
  }
  assert.deepEqual(counts, { idle: 100, turn: 100, move: 100, a: 100, b: 100, c: 100, text: 100 });
  assert.equal(pet.moved, 'move');
  assert.equal(pet.pendingSquash, true);
});

test('clicks retain fixed and no-mirror eligibility filters', () => {
  const pet = sprite(true, 'right');
  const chosen = [];
  for (let i = 0; i < 4; i++) {
    roll = (i + 0.5) / 4;
    pet.onClick({});
    chosen.push(pet.chosen);
  }
  assert.deepEqual(chosen, ['idle', 'a', 'b', 'c']);
});

test('clicking a movement during an automatic rest cancels the old rest timer', t => {
  const timers = new Map();
  let timerId = 0;
  context.window = {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.VIEW = { w: 1920, h: 1080 };
  context.AREAS = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  t.after(() => { delete context.window; delete context.VIEW; delete context.AREAS; });
  const pet = sprite();
  Object.assign(pet, {
    actionGapMs: 30000, actionRestUntil: Date.now() + 30000,
    moveRef: null, pendingMove: null, throwRef: null,
    size: 462, halfW: 231, sideAllow: 144,
    currentCenterX: () => 960, currentCenterY: () => 540,
    stopMove() { this.pendingMove = null; },
    playOnce: context.PetSprite.prototype.playOnce,
    tryMove: context.PetSprite.prototype.tryMove,
    switchTo(name) { this.chosen = name; },
    animations: { ...animations, moves: {
      actions: animations.moves.actions,
      default: { minDist: 60, maxDist: 120, margin: 20, leadSec: 2, tailSec: 2 },
    } },
  });
  pet.playIdle();
  assert.equal(timers.size, 1, 'automatic rest schedules the next random action');
  roll = 2.5 / 7;
  pet.onClick({});
  assert.equal(pet.chosen, 'move');
  assert.ok(pet.pendingMove, 'real movement planning succeeded');
  for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  assert.equal(pet.chosen, 'move', 'the old rest timer must not replace the clicked movement');
  assert.ok(pet.pendingMove);
  assert.equal(timers.size, 0);
});

test('fixed and mirrored pets sample only eligible actions, still uniformly', () => {
  const pet = sprite(true, 'right');
  const chosen = [];
  for (let i = 0; i < 4; i++) {
    roll = (i + 0.5) / 4;
    pet.playIdle();
    chosen.push(pet.chosen);
  }
  assert.deepEqual(chosen, ['idle', 'a', 'b', 'c']);
});

test('blocked movement plays the selected clip in place without weighting another action higher', () => {
  const pet = sprite();
  pet.tryMove = () => false;
  roll = 2.5 / 7;
  pet.playIdle();
  assert.equal(pet.chosen, 'move');
});

test('a pet still in flight keeps the animation chain alive when a movement is selected', () => {
  const pet = sprite();
  pet.tryMove = context.PetSprite.prototype.tryMove;
  pet.moveRef = null;
  pet.pendingMove = null;
  pet.throwRef = 123;
  roll = 2.5 / 7;
  pet.playIdle();
  assert.equal(pet.chosen, 'move', 'busy movement must still play the selected clip so ended can continue the chain');
  assert.equal(pet.throwRef, 123, 'the existing flight is not interrupted');
});

test('source and shipped selector agree, including duplicate names and empty eligible pools', async t => {
  const { pickRandomAction } = await import('../shared/pickers.ts');
  t.mock.method(Math, 'random', () => roll);
  const duplicate = { ...animations, categories: [{ id: 'duplicate', weight: 100, actions: ['a', 'a', 'idle'] }] };
  for (const fixture of [animations, duplicate]) {
    for (const fixed of [true, false]) for (const facing of ['left', 'right']) {
      for (let i = 0; i < 100; i++) {
        roll = (i + 0.5) / 100;
        const source = pickRandomAction(fixture, facing, { fixed });
        const shipped = context.S.pickRandomAction(fixture, facing, { fixed });
        assert.deepEqual({ ...shipped }, source);
      }
    }
  }
  const pool = new Set();
  for (let i = 0; i < 4; i++) {
    roll = (i + 0.5) / 4;
    pool.add(pickRandomAction(duplicate, 'left').name);
  }
  assert.deepEqual([...pool], ['idle', 'turn', 'move', 'a']);
  const empty = { idle: [], turn: [], moves: { actions: [] }, categories: [] };
  assert.equal(pickRandomAction(empty, 'left'), null);
  assert.equal(context.S.pickRandomAction(empty, 'left'), null);
});
