import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { notePlacement } = require('../../runtime/electron-helper/note.js');

test('the board follows its holding anchor and has a bounded size', () => {
  const p = notePlacement({ x: 400, y: 400 }, { x: 0, y: 0, w: 900, h: 800 });
  assert.deepEqual(p, { x: 260, y: 136, w: 280, h: 272 });
});

test('the intended overlap with raised hands does not move the board sideways', () => {
  const p = notePlacement({ x: 462, y: 330 }, { x: 0, y: 0, w: 924, h: 780 }, { x: 375, y: 288, w: 173 });
  assert.equal(p.x, 322);
  assert.equal(p.y, 66);
});

test('the board fits at every screen corner, including a small visible window', () => {
  for (const bounds of [{ x: 80, y: 90, w: 480, h: 360 }, { x: 10, y: 20, w: 190, h: 150 }]) {
    for (const anchor of [{ x: -100, y: -100 }, { x: 1000, y: 1000 }]) {
      const p = notePlacement(anchor, bounds);
      assert.ok(p.x >= bounds.x + 8 && p.y >= bounds.y + 8);
      assert.ok(p.x + p.w <= bounds.x + bounds.w - 8);
      assert.ok(p.y + p.h <= bounds.y + bounds.h - 8);
      assert.ok(p.w <= 280 && p.h <= 272);
    }
  }
});

test('a pet near the screen top leaves space for the board beside its body', () => {
  const body = { x: 300, y: 10, w: 170 };
  const p = notePlacement({ x: 310, y: 0 }, { x: 0, y: 0, w: 900, h: 700 }, body);
  assert.ok(p.x > body.x + body.w);
  assert.ok(p.y >= 8);
});
