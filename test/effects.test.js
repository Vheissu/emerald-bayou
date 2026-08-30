import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Precipitation } from '../src/environment.js';

test('precipitation packs state into typed arrays without duplicate objects', () => {
  const precipitation = new Precipitation(new THREE.Scene(), { rain: 4, hail: 3 });
  assert.equal('drops' in precipitation.rain, false);
  assert.equal('stones' in precipitation.hail, false);
  assert.ok(precipitation.rain.speed instanceof Float32Array);
  assert.ok(precipitation.hail.speed instanceof Float32Array);
  assert.equal(precipitation.rain.speed.length, 4);
  assert.equal(precipitation.hail.speed.length, 3);

  precipitation.update(1 / 60, { x: 10, z: 20 }, { x: 1, z: 0 }, 1, 1, 0);
  assert.equal(precipitation.rain.geo.drawRange.count, 8);
  assert.equal(precipitation.hail.geo.drawRange.count, 3);
  assert.equal(precipitation.rain.geo.attributes.position.updateRanges[0].count, 24);
  assert.equal(precipitation.hail.geo.attributes.position.updateRanges[0].count, 9);
  const rainRange = precipitation.rain.geo.attributes.position.updateRanges[0];
  precipitation.update(1 / 60, { x: 10, z: 20 }, { x: 1, z: 0 }, 1, 1, 0);
  assert.equal(precipitation.rain.geo.attributes.position.updateRanges[0], rainRange);
  precipitation.update(1 / 60, { x: 10, z: 20 }, { x: 1, z: 0 }, 0, 0, 0);
  assert.equal(precipitation.rain.geo.drawRange.count, 0);
  assert.equal(precipitation.hail.geo.drawRange.count, 0);
});

test('spray and plume compact expired particles and draw only live slots', async () => {
  const gradient = () => ({ addColorStop() {} });
  const context = { createRadialGradient: gradient, beginPath() {}, arc() {}, fill() {}, fillRect() {} };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const { Spray, Plume } = await import('../src/particles.js');

  const spray = new Spray(3);
  assert.equal(spray.geo.drawRange.count, 0);
  spray.emit(1, 1, 1, 0, 0, 0, 0.1, 0.01);
  spray.emit(2, 1, 2, 0, 0, 0, 0.1, 1);
  spray.update(0.02);
  assert.equal(spray.count, 1);
  assert.equal(spray.geo.drawRange.count, 1);
  assert.equal(spray.pos[0], 2);
  assert.equal(spray.geo.attributes.position.updateRanges[0].count, 3);
  assert.equal(spray.geo.attributes.aSize.updateRanges[0].count, 1);
  const sprayRange = spray.geo.attributes.position.updateRanges[0];
  spray.update(0.01);
  assert.equal(spray.geo.attributes.position.updateRanges[0], sprayRange);
  for (let i = 0; i < 5; i++) spray.emit(10 + i, 1, 0, 0, 0, 0, 0.1, 1);
  assert.equal(spray.count, 3);
  assert.equal(spray.geo.drawRange.count, 3);
  spray.clear();
  assert.equal(spray.count, 0); assert.equal(spray.head, 0); assert.equal(spray.geo.drawRange.count, 0);
  spray.emit(12, 1, 0, 0, 0, 0, 0.1, 1);
  spray.update(2);
  assert.equal(spray.count, 0);
  assert.equal(spray.geo.drawRange.count, 0);

  const plume = new Plume(3);
  assert.equal(plume.geo.instanceCount, 0);
  plume.emit(1, 1, 1, 0, 0, 0, 0.2, 0.1, 0.01);
  plume.emit(2, 1, 2, 0, 0, 0, 0.2, 0.1, 1);
  plume.update(0.02, 1);
  assert.equal(plume.count, 1);
  assert.equal(plume.geo.instanceCount, 1);
  assert.equal(plume.pos[0], 2);
  assert.equal(plume.geo.attributes.aPos.updateRanges[0].count, 3);
  assert.equal(plume.geo.attributes.aData.updateRanges[0].count, 4);
  plume.clear();
  assert.equal(plume.count, 0); assert.equal(plume.head, 0); assert.equal(plume.geo.instanceCount, 0);
  plume.emit(3, 1, 3, 0, 0, 0, 0.2, 0.1, 1);
  plume.update(2, 3);
  assert.equal(plume.count, 0);
  assert.equal(plume.geo.instanceCount, 0);
});
