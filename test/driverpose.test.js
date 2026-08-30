import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createProceduralDriverMount, createSeatedDriverMount, installDriver, loadDriver, replaceSeatedDriverModel,
  seatedDriverPoseTargets, updateSeatedDriverPose,
} from '../src/airboat.js';
import { configureModelLoading } from '../src/models.js';

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

test('low-memory airboat operators are visible immediately and reuse the resident resource library', () => {
  const first = createProceduralDriverMount({ seed: 741 }), second = createProceduralDriverMount({ seed: 741 });
  const firstMeshes = [], secondMeshes = [];
  first.userData.model.traverse(object => { if (object.isMesh) firstMeshes.push(object); });
  second.userData.model.traverse(object => { if (object.isMesh) secondMeshes.push(object); });

  assert.equal(first.userData.fallback, true);
  assert.deepEqual(first.position.toArray(), [0, 1.7, 0.4]);
  assert.equal(first.userData.operator.userData.kind, 'person');
  assert.equal(first.userData.operator.userData.pose, 'sit');
  assert.equal(first.userData.operator.userData.drive, true);
  assert.ok(first.userData.model.getObjectByName('procedural driver seat'));
  assert.ok(first.userData.model.getObjectByName('procedural driver pedestal'));
  assert.ok(firstMeshes.length >= 18 && firstMeshes.length <= 28);
  assert.equal(firstMeshes.length, secondMeshes.length);
  for (let i = 0; i < firstMeshes.length; i++) {
    assert.equal(firstMeshes[i].geometry, secondMeshes[i].geometry);
    assert.equal(firstMeshes[i].material, secondMeshes[i].material);
  }
});

test('authored driver replacement preserves the animated mount and shares loaded render resources', () => {
  const mount = createProceduralDriverMount({ seed: 91 });
  const physics = { speed: 4, steer: 0.6, angVel: 0.4, rpm: 0.7, hit: 0, impact: 0 };
  const state = updateSeatedDriverPose(mount, physics, 1 / 60, 1);
  const oldModel = mount.userData.model, position = mount.position.clone(), rotation = mount.rotation.clone();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const source = new THREE.Group(); source.add(new THREE.Mesh(geometry, material));

  const replacement = replaceSeatedDriverModel(mount, source, { scale: 0.65, yaw: Math.PI });
  const mesh = replacement.getObjectByProperty('isMesh', true);
  assert.equal(oldModel.parent, null);
  assert.equal(replacement.parent, mount);
  assert.equal(mount.userData.seatedDriverPose, state);
  assert.deepEqual(mount.position.toArray(), position.toArray());
  assert.deepEqual(mount.rotation.toArray(), rotation.toArray());
  assert.equal(mount.userData.fallback, false);
  assert.equal(mount.userData.operator, null);
  assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
  geometry.dispose(); material.dispose();
});

test('disabled driver downloads leave immediate fallbacks in place without hiding johnboat crew', async () => {
  configureModelLoading({ disabled: ['driver'] });
  const airboat = new THREE.Group(), mount = installDriver(airboat, { seed: 617 });
  const ready = mount.userData.modelReady;
  assert.equal(airboat.children[0], mount);
  assert.equal(mount.userData.fallback, true);
  assert.ok(mount.userData.operator.visible);
  assert.equal(await ready, mount);
  assert.equal(mount.userData.modelReady, null);
  assert.equal(mount.userData.modelLoadFailed, undefined);

  const johnboat = new THREE.Group(), proceduralCrew = new THREE.Group(); proceduralCrew.visible = true; johnboat.add(proceduralCrew);
  const authored = await loadDriver(johnboat, { scale: 0.48, position: [0.16, 0.49, 1.16] });
  if (authored) proceduralCrew.visible = false;
  assert.equal(authored, null);
  assert.equal(proceduralCrew.visible, true);
  assert.equal(johnboat.children.length, 1);
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
