import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSeatedDriverMount, seatedDriverPoseTargets, updateSeatedDriverPose } from '../src/airboat.js';

test('driver mount preserves the resident lookout contract and shares render resources', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const source = new THREE.Group(); source.add(new THREE.Mesh(geometry, material));
  const mount = createSeatedDriverMount(source, { scale: 0.48, position: [0.16, 0.49, 1.16], yaw: Math.PI });
  const clone = mount.userData.model.getObjectByProperty('isMesh', true);
  assert.equal(mount.userData.baseYaw, 0);
  assert.deepEqual(mount.position.toArray(), [0.16, 0.49, 1.16]);
  assert.equal(mount.userData.model.rotation.y, Math.PI);
  assert.deepEqual(mount.userData.model.scale.toArray(), [0.48, 0.48, 0.48]);
  assert.equal(clone.geometry, geometry);
  assert.equal(clone.material, material);
  geometry.dispose(); material.dispose();
});

test('driver braces for acceleration and wind while looking and leaning into a turn', () => {
  const out = {};
  assert.equal(seatedDriverPoseTargets({ steer: 0.8, angVel: 0.6, apparentWind: 0, pitch: 0, roll: 0 }, 5, out), out);
  assert.ok(out.pitch > 0.03);
  assert.ok(out.roll > 0.04);
  assert.ok(out.yaw > 0.03);

  const storm = seatedDriverPoseTargets({ steer: 0, angVel: 0, apparentWind: 50, pitch: 0.2, roll: 0.2 }, 0);
  assert.ok(storm.pitch < -0.05);
  assert.ok(storm.roll < -0.05);
});

test('driver pose reuses retained state, absorbs a crash and settles inside safe limits', () => {
  const driver = new THREE.Group(); driver.position.set(0, 1.7, 0.4);
  const physics = {
    speed: 0, steer: 0.75, angVel: 0.55, pitch: 0, roll: 0, apparentWind: 0,
    rpm: 0.8, airborne: false, airTime: 0, impact: 0, hit: 0, heading: 0,
    hitNormal: new THREE.Vector2(1, 0),
  };
  const first = updateSeatedDriverPose(driver, physics, 1 / 60, 0);
  const target = first.target;
  for (let frame = 1; frame <= 90; frame++) {
    physics.speed += 4.5 / 60;
    assert.equal(updateSeatedDriverPose(driver, physics, 1 / 60, frame / 60), first);
  }
  assert.equal(first.target, target);
  assert.ok(driver.rotation.x > 0.015);
  assert.ok(driver.rotation.z > 0.035);

  physics.hit = 9; physics.impact = 7;
  const pitchVelocity = first.pitchVelocity, heightVelocity = first.heightVelocity;
  updateSeatedDriverPose(driver, physics, 1 / 60, 1.6);
  assert.ok(first.pitchVelocity < pitchVelocity);
  assert.ok(first.heightVelocity < heightVelocity);

  physics.hit = 0; physics.impact = 0; physics.steer = 0; physics.angVel = 0; physics.speed = 0; physics.rpm = 0;
  for (let frame = 0; frame < 360; frame++) updateSeatedDriverPose(driver, physics, 1 / 60, 2 + frame / 60);
  assert.ok(Math.abs(first.pitch) < 0.004);
  assert.ok(Math.abs(first.roll) < 0.004);
  assert.ok(Math.abs(first.yaw) < 0.004);
  assert.ok(Math.abs(first.height) < 0.002);
  assert.ok(Math.abs(driver.rotation.x) <= 0.171);
  assert.ok(Math.abs(driver.rotation.z) <= 0.181);
});
