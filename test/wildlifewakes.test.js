import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Gators } from '../src/wildlife.js';
import { WakeStampPool } from '../src/wakestamps.js';

const animal = (x, z, options = {}) => ({
  pos: new THREE.Vector3(x, -0.6, z), heading: options.heading ?? 0,
  wakeSpeed: options.wakeSpeed ?? 0.55, wakeKick: options.wakeKick ?? 0,
  surfaced: options.surfaced ?? true, bask: options.bask ?? false,
  mesh: { visible: options.visible ?? true, scale: new THREE.Vector3(options.scale ?? 1, 1, 1) },
});

const gatorSystem = list => Object.assign(Object.create(Gators.prototype), {
  list, wakeBoatX: 0, wakeBoatZ: 0, wakeActive: 0, eyeshinePool: { resourceStats: () => ({}) },
});

test('only the nearest swimming alligator consumes the two-slot wildlife wake budget', () => {
  const farther = animal(15, 0, { heading: -Math.PI / 2, wakeSpeed: 5.5 });
  const nearest = animal(6, 0, { heading: -Math.PI / 2, wakeSpeed: 0.55 });
  const pool = new WakeStampPool(8), gators = gatorSystem([farther, nearest]);

  assert.equal(gators.stamps(pool), 2);
  assert.equal(pool.count, 2);
  assert.equal(gators.resourceStats().wakeCapacity, 2);
  assert.ok(pool.items[0].x > nearest.pos.x);
  assert.ok(pool.items[1].x < nearest.pos.x);
  assert.ok(Math.abs(pool.items[0].z - nearest.pos.z) < 1e-12);
  assert.ok(pool.items[0].height < 0 && pool.items[1].height > 0);
  assert.ok(pool.items[1].foam > pool.items[0].foam);
});

test('a dive pulse replaces the travelling wake and reuses one frame slot', () => {
  const diving = animal(5, -4, { surfaced: false, wakeSpeed: 5.5, wakeKick: 0.8, scale: 1.4 });
  const pool = new WakeStampPool(8), gators = gatorSystem([diving]);

  assert.equal(gators.stamps(pool), 1);
  assert.equal(pool.count, 1);
  assert.equal(pool.items[0].x, diving.pos.x);
  assert.equal(pool.items[0].z, diving.pos.z);
  assert.ok(pool.items[0].height < -0.35);
  assert.ok(pool.items[0].foam > 0.6);
  assert.ok(pool.items[0].foamRadius > pool.items[0].radius);
});

test('submerged, basking and distant alligators leave the frame pool untouched', () => {
  const gators = gatorSystem([
    animal(4, 0, { surfaced: false }),
    animal(6, 0, { bask: true, wakeKick: 0.85 }),
    animal(90, 0, { wakeSpeed: 5.5 }),
  ]);
  const pool = new WakeStampPool(2);

  assert.equal(gators.stamps(pool), 0);
  assert.equal(pool.count, 0);
});

test('scaring a surfaced alligator arms one bounded dive disturbance', () => {
  const gator = animal(3, 4, { wakeSpeed: 0, wakeKick: 0 });
  gator.dive = 0;
  const gators = gatorSystem([gator]);

  gators.scare(0, 0, 6);
  assert.ok(gator.dive >= 6 && gator.dive <= 10);
  assert.equal(gator.wakeKick, 0.85);
  const pool = new WakeStampPool(2);
  assert.equal(gators.stamps(pool), 1);
  assert.equal(pool.count, 1);
});
