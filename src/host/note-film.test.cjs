const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(size = 462) {
  const canvases = [];
  const document = { createElement() {
    const calls = [];
    const transforms = [];
    const context = { globalAlpha: 1, globalCompositeOperation: 'source-over',
      scale(...args) { transforms.push(['scale', ...args]); },
      translate(...args) { transforms.push(['translate', ...args]); },
      save() {}, restore() {}, clearRect() {}, fillRect() {},
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
  const context = { window: { devicePixelRatio: 1 }, document };
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

test('opening and closing preserve the ordinary video facing in their boundary frames', () => {
  for (const transform of ['', 'scaleX(-1)']) {
    const { film } = fixture();
    const resting = { readyState: 2, style: { transform } };
    film.setClip('拿出', resting);
    film.draw(1);
    film.setClip('收起', resting);
    film.draw(5);
    const flips = film.canvas.transforms.filter(([op, x]) => op === 'scale' && x === -1);
    assert.equal(flips.length, transform ? 2 : 0, 'both boundary snapshots must retain the displayed facing');
    if (transform) {
      const translations = film.canvas.transforms.filter(([op]) => op === 'translate');
      assert.deepEqual(translations, [['translate', 1102, 0], ['translate', 1102, 0]]);
    }
  }
});
