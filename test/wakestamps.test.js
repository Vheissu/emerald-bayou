import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { emitWakeStamp, WakeStampPool } from '../src/wakestamps.js';
import { Water } from '../src/water.js';

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

test('pooled systems copy into the bounded frame pool without sharing mutable slots', () => {
  const system = new WakeStampPool(2);
  system.emit(1, 2, 3, 4, 5, 6);
  system.emit(7, 8, 9, 10, 11, 12);
  const frame = new WakeStampPool(1), retained = frame.items[0];
  system.appendTo(frame);
  assert.equal(frame.items[0], retained);
  assert.deepEqual(frame.items[0], { x: 1, z: 2, radius: 3, height: 4, foam: 5, foamRadius: 6 });
  assert.equal(frame.count, 1);
  assert.equal(frame.droppedFrame, 1);
  assert.equal(frame.items.length, 1);
});

test('wake emission preserves the previous array interface outside the live frame pool', () => {
  const out = [];
  emitWakeStamp(out, 3, 4, 5, 6, 7, 8);
  assert.deepEqual(out, [{ x: 3, z: 4, radius: 5, height: 6, foam: 7, foamRadius: 8 }]);
});

test('water simulation reads the retained frame pool directly', () => {
  const pool = new WakeStampPool(2);
  pool.emit(12, 22, 5, 0.7, 1.2, 6);
  const water = {
    wakeNeedsClear: false, wakeCell: 1, wakeOrigin: new THREE.Vector2(), wakeMaxStamps: 20,
    simMat: { uniforms: { shift: { value: new THREE.Vector2() }, advection: { value: new THREE.Vector2() }, stampCount: { value: 0 }, tPrev: { value: null } } },
    stamps: Array.from({ length: 20 }, () => new THREE.Vector4()), foamStamps: Array.from({ length: 20 }, () => new THREE.Vector4()),
    renderer: { setRenderTarget() {}, render() {} }, wakeA: { texture: { id: 'a' } }, wakeB: { texture: { id: 'b' } }, uniforms: { tWake: { value: null } }, simScene: {}, simCam: {},
  };
  Water.prototype.simulate.call(water, new THREE.Vector2(10, 20), pool, 0.5, new THREE.Vector2());
  assert.equal(water.simMat.uniforms.stampCount.value, 1);
  assert.deepEqual(water.stamps[0].toArray(), [0.5 + 2 / 150, 0.5 + 2 / 150, 5 / 150, 0.35]);
  assert.deepEqual(water.foamStamps[0].toArray(), [0.5 + 2 / 150, 0.5 + 2 / 150, 6 / 150, 0.6]);
  assert.equal(water.uniforms.tWake.value.id, 'b');
});
