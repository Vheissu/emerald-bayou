import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkiffAI } from '../src/npc.js';

test('a pooled skiff is placed on its new start line before the first update', () => {
  const motor = new THREE.Group(), mesh = new THREE.Group(); mesh.userData.motor = motor;
  const skiff = Object.assign(Object.create(SkiffAI.prototype), {
    mesh, pos: new THREE.Vector2(), vel: new THREE.Vector2(), heading: 1, speed: 4, active: false, done: true,
    roll: 0.3, pitch: -0.2, dist: 18, waveFn: () => 0.4,
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
});
