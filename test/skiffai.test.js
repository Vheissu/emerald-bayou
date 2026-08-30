import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkiffAI } from '../src/npc.js';

test('a pooled skiff is placed on its new start line before the first update', () => {
  const motor = new THREE.Group(), mesh = new THREE.Group(); mesh.userData.motor = motor;
  const skiff = Object.assign(Object.create(SkiffAI.prototype), {
    mesh, pos: new THREE.Vector2(), vel: new THREE.Vector2(), heading: 1, speed: 4, active: false, done: true,
    roll: 0.3, pitch: -0.2, dist: 18, waveFn: () => 0.4, shoveX: 2, shoveZ: -3, yawKick: 0.4, heelKick: -0.2,
  });
  skiff.start([{ x: 12, z: -8 }, { x: 12, z: -40 }], 11.4);
  assert.deepEqual(skiff.pos.toArray(), [12, -8]);
  assert.deepEqual([mesh.position.x, mesh.position.z], [12, -8]);
  assert.ok(Math.abs(mesh.position.y - 0.35) < 1e-9);
  assert.ok(Math.abs(mesh.rotation.y) < 1e-9);
  assert.equal(mesh.visible, true);
  assert.equal(skiff.active, true);
  assert.equal(skiff.done, false);
  assert.equal(skiff.lookAhead, 14);
  assert.equal(skiff.roll, 0);
  assert.equal(skiff.pitch, 0);
  assert.deepEqual([skiff.shoveX, skiff.shoveZ, skiff.yawKick, skiff.heelKick], [0, 0, 0, 0]);
});

test('a rival hull hit produces a bounded reciprocal slide, yaw, and heel without allocating impact state', () => {
  const motor = new THREE.Group(); motor.userData.prop = new THREE.Group();
  const mesh = new THREE.Group(); mesh.userData.motor = motor;
  const skiff = Object.assign(Object.create(SkiffAI.prototype), {
    mesh, pos: new THREE.Vector2(0, 0), vel: new THREE.Vector2(), heading: 0, speed: 8, maxSpeed: 11.4,
    path: [{ x: 0, z: 0 }, { x: 0, z: -200 }], i: 1, active: true, done: false, waveFn: () => 0,
    roll: 0, pitch: 0, dist: 0, lookAhead: 8, shoveX: 0, shoveZ: 0, yawKick: 0, heelKick: 0,
    _flow: new THREE.Vector2(), _forward: new THREE.Vector2(),
  });
  const retained = [skiff.pos, skiff.vel, skiff._flow, skiff._forward];

  assert.equal(skiff.applyImpact(8, -1, 0, 1.8), true);
  assert.ok(skiff.shoveX > 3.8 && skiff.shoveX <= 5.4, 'rival should slide away from the player');
  assert.ok(skiff.yawKick < 0, 'a hit on the starboard bow should knock the bow to port');
  assert.ok(skiff.heelKick > 0, 'starboard contact should heel the hull away from the player');
  const before = { shove: Math.hypot(skiff.shoveX, skiff.shoveZ), yaw: skiff.yawKick, heel: Math.abs(skiff.heelKick), x: skiff.pos.x };
  skiff.update(1 / 60, 1);
  assert.ok(skiff.pos.x > before.x, 'the retained shove must affect the next movement step');
  assert.ok(Math.hypot(skiff.shoveX, skiff.shoveZ) < before.shove);
  assert.ok(Math.abs(skiff.yawKick) < Math.abs(before.yaw));
  assert.ok(Math.abs(skiff.heelKick) < before.heel);
  assert.ok(skiff.roll > 0);
  assert.deepEqual([skiff.pos, skiff.vel, skiff._flow, skiff._forward], retained);

  skiff.applyImpact(40, 1, 1, -20);
  assert.ok(Math.hypot(skiff.shoveX, skiff.shoveZ) <= 5.4000001);
  assert.ok(Math.abs(skiff.yawKick) <= 1.1);
  assert.ok(Math.abs(skiff.heelKick) <= 0.22);
});
