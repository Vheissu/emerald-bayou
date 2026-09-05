import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeDrawingSurface } from '../src/renderersize.js';

function rendererFixture() {
  let width = 1280, height = 720, ratio = 1;
  const calls = [], style = { width: '1280px', height: '720px' };
  const renderer = {
    domElement: { width: 1280, height: 720, style },
    getSize: out => out.set(width, height), getPixelRatio: () => ratio,
    setPixelRatio() { throw new Error('redundant resizing path'); }, setSize() { throw new Error('redundant resizing path'); },
    setDrawingBufferSize(w, h, r) {
      calls.push([w, h, r]); width = w; height = h; ratio = r;
      renderer.domElement.width = Math.floor(w * r); renderer.domElement.height = Math.floor(h * r);
    },
  };
  return { renderer, calls, style };
}

test('a pixel-ratio change uses one drawing-buffer update and identical resizes are no-ops', () => {
  const { renderer, calls } = rendererFixture();
  assert.equal(resizeDrawingSurface(renderer, 1280, 720, 1.5), true);
  assert.deepEqual(calls, [[1280, 720, 1.5]]);
  assert.deepEqual([renderer.domElement.width, renderer.domElement.height], [1920, 1080]);
  for (let i = 0; i < 50; i++) assert.equal(resizeDrawingSurface(renderer, 1280, 720, 1.5), false);
  assert.equal(calls.length, 1);
});

test('hibernation collapses directly to one pixel without changing the displayed CSS size', () => {
  const { renderer, calls, style } = rendererFixture();
  resizeDrawingSurface(renderer, 1, 1, 1, false);
  assert.deepEqual(calls, [[1, 1, 1]]); assert.deepEqual(style, { width: '1280px', height: '720px' });
  resizeDrawingSurface(renderer, 1440, 900, 1.25);
  assert.deepEqual(calls[1], [1440, 900, 1.25]); assert.deepEqual(style, { width: '1440px', height: '900px' });
});

test('invalid dimensions cannot request an unbounded drawing surface', () => {
  const { renderer, calls } = rendererFixture();
  resizeDrawingSurface(renderer, Infinity, NaN, NaN);
  assert.deepEqual(calls, [[1, 1, 1]]);
});
