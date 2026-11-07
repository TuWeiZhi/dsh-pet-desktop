const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(size = 462, reducedMotion = false) {
  const canvases = [];
  const document = { createElement() {
    const calls = [];
    const transforms = [];
    const stack = [];
    const context = { globalAlpha: 1, globalCompositeOperation: 'source-over',
      scale(...args) { transforms.push(['scale', ...args]); },
      translate(...args) { transforms.push(['translate', ...args]); },
      transform(...args) { transforms.push(['transform', ...args]); },
      save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); }, clearRect() {}, fillRect() {},
      drawImage(...args) { calls.push({ args, alpha: this.globalAlpha, operation: this.globalCompositeOperation }); },
    };
    const canvas = { style: {}, hidden: false, getContext: () => context, remove() {}, calls, transforms };
    canvases.push(canvas);
    return canvas;
  } };
  let callback;
  const video = { readyState: 2, playbackRate: 1, addEventListener() {}, removeEventListener() {},
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() { callback = null; },
  };
  const context = { window: { devicePixelRatio: 1, matchMedia: () => ({ matches: reducedMotion }) }, document,
    getComputedStyle(video) { return { opacity: '1', transformOrigin: `${size/2}px ${size*9/32}px`,
      transform: video.style.transform ? 'matrix(-1, 0, 0, 1, 0, 0)' : 'none' }; },
    DOMMatrixReadOnly: class {
      constructor(value) {
        const values = value ? value.slice(7, -1).split(',').map(Number) : [1, 0, 0, 1, 0, 0];
        ['a', 'b', 'c', 'd', 'e', 'f'].forEach((key, i) => { this[key] = values[i]; });
      }
    },
  };
  for (const file of ['note-media-data.js', 'note-film.js']) {
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../runtime/electron-helper', file), 'utf8'), context);
  }
  const film = new context.window.PetNoteFilm(video, { appendChild() {} }, size, () => ({ x: 0, y: 0 }), () => {});
  return { film, video, canvases, callback: () => callback };
}

test('opening, holding and closing keep the configured pet scale at every size', () => {
  for (const size of [120, 300, 462, 800]) {
    const { film, video } = fixture(size);
    for (const clip of ['拿出', '待机', '上一页', '下一页', '收起']) {
      film.setClip(clip);
      for (const time of [0, .5, 2, 4.9]) {
        film.draw(time);
        const draw = film.canvas.calls.filter(call => call.args[0] === video).at(-1);
        assert.equal(draw.args[3], size, `${clip} at ${time}s must not zoom a ${size}px pet`);
        assert.equal(draw.args[4], size * .75);
      }
    }
  }
});

test('clip changes blend from the displayed frame, keeping full opacity on shared pixels', () => {
  const { film, video } = fixture();
  film.setClip('拿出'); film.draw(4.9);
  film.setClip('待机'); film.draw(0);
  let draw = film.canvas.calls.filter(call => call.args[0] === video).at(-1);
  assert.equal(draw.alpha, 0, 'first decoded frame must not hard-cut the displayed pose');
  film.draw(.09);
  draw = film.canvas.calls.filter(call => call.args[0] === video).at(-1);
  assert.ok(draw.alpha > 0 && draw.alpha < 1);
  assert.equal(draw.operation, 'lighter', 'premultiplied frame weights must add, not reveal the desktop');
  film.draw(.3);
  assert.equal(film.context.globalAlpha, 1);
  assert.equal(film.context.globalCompositeOperation, 'source-over');
});

test('stopping from a frame callback cannot schedule a new draw after hide', () => {
  const { film, callback } = fixture();
  film.setClip('拿出');
  film.onFrame = () => film.hide();
  film.schedule();
  callback()(0, { mediaTime: 1 });
  assert.equal(film.frameRequest, null);
  assert.equal(film.canvas.hidden, true);
});

test('opening immediately holds the ordinary pose, then blends over 350ms at either playback speed', () => {
  for (const speed of [1, 2, 4]) {
    const { film, video } = fixture();
    video.playbackRate = speed;
    const frames = [];
    film.onFrame = (name, time) => frames.push([name, time]);
    film.setClip('拿出', { readyState: 2, style: { transform: '' } });
    assert.equal(film.canvas.hidden, false, 'hold the snapshot before the decoder delivers a frame');
    assert.deepEqual(frames, [['拿出', 0]]);
    for (const [elapsed, alpha] of [[0, 0], [.175, .5], [.35, 1]]) {
      film.draw(elapsed * speed);
      const draw = film.canvas.calls.filter(call => call.args[0] === video).at(-1);
      assert.ok(Math.abs(draw.alpha - alpha) < .0001);
    }
    film.setClip('待机');
    assert.equal(film.blendDuration, .18, 'internal note clips keep their existing transition');
  }
});

test('reduced motion holds the loading snapshot without introducing an opening blend', () => {
  const { film, video } = fixture(462, true);
  film.setClip('拿出', { readyState: 2, style: { transform: '' } });
  assert.equal(film.canvas.hidden, false);
  assert.equal(film.blending, false);
  film.draw(0);
  const draw = film.canvas.calls.filter(call => call.args[0] === video).at(-1);
  assert.equal(draw.alpha, 1);
});

test('opening and closing preserve the ordinary video facing in their boundary frames', () => {
  for (const transform of ['', 'scaleX(-1)']) {
    const { film } = fixture();
    const resting = { readyState: 2, style: { transform } };
    film.setClip('拿出', resting);
    film.draw(1);
    film.setClip('收起', resting);
    film.draw(5);
    const opening = film.canvas.transforms.find(([op]) => op === 'transform');
    assert.deepEqual(opening, ['transform', transform ? -1 : 1, 0, 0, 1, 0, 0]);
    const closing = film.previous.transforms.find(([op]) => op === 'transform');
    assert.deepEqual(closing, opening, 'closing and opening both preserve the CSS transform');
  }
});

test('closing eases into the ordinary composite over the final 350ms without extra canvas allocations', () => {
  for (const speed of [1, 2, 4]) {
    const { film, video, canvases } = fixture();
    video.playbackRate = speed;
    film.setClip('收起', { readyState: 2, style: { transform: '' } });
    film.draw(0);
    for (const fraction of [.25, .5, .75, 1]) {
      film.draw(5 - .35 * speed * (1 - fraction));
      const draw = film.canvas.calls.filter(call => call.args[0] === film.previous).at(-1);
      const alpha = fraction * fraction * (3 - 2 * fraction);
      assert.ok(Math.abs(draw.alpha - alpha) < .0001);
    }
    assert.equal(canvases.length, 2);
    assert.equal(film.previous.calls.filter(call => call.args[0] !== film.canvas).length, 1, 'capture the return pose once');
  }
});
