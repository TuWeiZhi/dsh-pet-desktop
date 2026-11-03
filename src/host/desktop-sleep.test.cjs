const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'runtime/electron-helper/sprite.js'), 'utf8');
const context = { console, window: {}, navigator: { platform: 'Win32' }, S: { pick: values => values[0] } };
vm.runInNewContext(source + '\nthis.PetSprite = PetSprite;', context);
const prototype = context.PetSprite.prototype;

function sprite() {
  const calls = [];
  const pet = Object.create(prototype);
  Object.assign(pet, {
    assetRoot: 'main', sleepPhase: null, frozen: false, playback: null,
    dragState: { active: false }, note: { isOpen: false, close() {} },
    animations: { idle: ['idle'] }, calls,
    stopMove() {}, stopThrow() {}, clearActionGap() {}, renderBubble() {},
    playOnce(name) { calls.push(['once', name]); },
    switchTo(name, once) { calls.push(['switch', name, once]); },
    resumeWorkStatusAnim() { return false; },
  });
  return pet;
}

test('sleep starts, loops, wakes and resumes idle', () => {
  const pet = sprite();
  pet.startSleep();
  assert.equal(pet.sleepPhase, 'start');
  pet.handleEnded();
  assert.equal(pet.sleepPhase, 'loop');
  pet.wakeSleep();
  assert.equal(pet.sleepPhase, 'end');
  pet.handleEnded();
  assert.equal(pet.sleepPhase, null);
  assert.deepEqual(pet.calls, [['once', '睡觉-开始'], ['switch', '睡觉-循环', false], ['once', '睡觉-起来'], ['once', 'idle']]);
});

test('waking during the start cancels sleep without playing an unrelated wake pose', () => {
  const pet = sprite();
  pet.startSleep();
  pet.wakeSleep();
  assert.equal(pet.sleepPhase, null);
  assert.deepEqual(pet.calls, [['once', '睡觉-开始'], ['once', 'idle']]);
});

test('sleep is available only for the built-in pet and not while frozen', () => {
  const pet = sprite();
  pet.assetRoot = 'custom';
  pet.startSleep();
  pet.assetRoot = 'main';
  pet.frozen = true;
  pet.startSleep();
  assert.equal(pet.sleepPhase, null);
  assert.equal(pet.calls.length, 0);
});

test('an old video ending while sleep is loading does not skip the start pose', () => {
  const pet = sprite();
  pet.startSleep();
  pet.pending = { anim: '睡觉-开始' };
  pet.handleEnded();
  assert.equal(pet.sleepPhase, 'start');
  assert.equal(pet.calls.length, 1);
});

test('click wakes the pet and sleep blocks automatic speech', () => {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'runtime/electron-helper/events.js'), 'utf8'), context);
  const pet = sprite();
  pet.startSleep();
  pet.handleEnded();
  pet.showWhisper('hello');
  assert.equal(pet.calls.length, 2);
  pet.onClick({});
  assert.equal(pet.sleepPhase, 'end');
  assert.equal(pet.calls[2][1], '睡觉-起来');
});
