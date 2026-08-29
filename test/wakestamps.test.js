import test from 'node:test';
import assert from 'node:assert/strict';
import { WakeStampPool } from '../src/wakestamps.js';

test('wake stamps reuse fixed objects across simulation frames', () => {
  const pool = new WakeStampPool(2);
  const first = pool.emit(1, 2, 3, 4, 5, 6);
  pool.emit(7, 8, 9, 10, 11, 12);
  const out = []; pool.appendTo(out);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { x: 1, z: 2, radius: 3, height: 4, foam: 5, foamRadius: 6 });
  pool.reset();
  const reused = pool.emit(13, 14, 15, 16);
  assert.equal(reused, first);
  assert.deepEqual(reused, { x: 13, z: 14, radius: 15, height: 16, foam: 0, foamRadius: 15 });
});

test('wake pool stays bounded and reports overflow without growing', () => {
  const pool = new WakeStampPool(1);
  assert.ok(pool.emit(0, 0, 1, 1));
  assert.equal(pool.emit(0, 0, 2, 2), null);
  assert.equal(pool.count, 1);
  assert.equal(pool.items.length, 1);
  assert.equal(pool.droppedFrame, 1);
  assert.equal(pool.droppedTotal, 1);
  pool.reset();
  assert.equal(pool.droppedFrame, 0);
  assert.equal(pool.droppedTotal, 1);
});
