import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { animatePerson, person } from '../src/folk.js';
import { finishDockPose } from '../src/dockpose.js';
import { mulberry32 } from '../src/noise.js';

function figure(pose = 'stand') {
  const p = person(mulberry32(52), { pose, work: true });
  const u = p.userData;
  u.dockReaction = { state: 'idle', rest: 1, grip: 1, age: 0, gait: 0, distanceWalked: 0 };
  return p;
}

test('a dock greeting opens the free hand, moves the wrist, then relaxes while moored', () => {
  const p = figure(), u = p.userData, r = u.dockReaction, hand = u.arms[0].hand;
  const boat = { x: 5, z: 7, speed: 1 };
  const poseAt = (state, age) => { r.state = state; r.age = age; animatePerson(p, age, 1 / 60, boat, null); };
  poseAt('greet', 0.92);
  assert.ok(hand.morphTargetInfluences[0] < 0.02);
  const rotation = hand.rotation.z;
  poseAt('greet', 1.23);
  assert.ok(Math.abs(hand.rotation.z - rotation) > 0.37);
  poseAt('idle', 5);
  assert.ok(hand.morphTargetInfluences[0] > 0.2);
  assert.equal(hand.rotation.z, 0);
});

test('a planted foot holds its place on the deck as the hips travel past it', () => {
  const p = figure(), u = p.userData, r = u.dockReaction;
  r.state = 'evacuate'; r.rest = 0; r.gait = 1;
  const sample = distance => {
    p.position.z = distance; r.distanceWalked = distance;
    animatePerson(p, 1 + distance, 1 / 60, null, null);
    return u.legs[0].boot.getWorldPosition(new THREE.Vector3());
  };
  const first = sample(0.17), last = sample(0.41);
  assert.ok(first.distanceTo(last) < 0.015);
  assert.ok(Math.abs(last.y - 0.046) < 0.01);
  assert.ok(sample(0.87).y > last.y + 0.08);
});

test('both standing soles stay flat through a braced hip shift', () => {
  const p = figure(), u = p.userData;
  u.hips.position.set(0.026, 0.72, 0); u.hips.rotation.set(.08, -.19, .06);
  u.dockReaction.state = 'brace'; finishDockPose(u, 0);
  const normal = new THREE.Vector3(0, 1, 0);
  for (const leg of u.legs) {
    const q = leg.boot.getWorldQuaternion(new THREE.Quaternion());
    assert.ok(normal.clone().applyQuaternion(q).dot(normal) > 0.999);
    assert.ok(Math.abs(leg.boot.getWorldPosition(new THREE.Vector3()).y - 0.046) < 0.001);
  }
});
