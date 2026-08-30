import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { alligatorEyeshineExposure, alligatorFloatHeight, GatorEyeshinePool, Gators } from '../src/wildlife.js';

test('swimming and diving heights remain relative to the moving tide', () => {
  assert.ok(Math.abs(alligatorFloatHeight(-0.6, 0.4) + 0.2) < 1e-12);
  assert.ok(Math.abs(alligatorFloatHeight(-0.6, -0.3) + 0.9) < 1e-12);
  assert.ok(Math.abs(alligatorFloatHeight(-0.6, 0.4, 1) + 1.2) < 1e-12);
  assert.equal(alligatorFloatHeight('bad', 'bad', -4), -0.6);
});

test('the live gator update follows the tide and forwards the retained light state', () => {
  let lightState = null;
  const mesh = new THREE.Object3D(), gator = {
    mesh, pos: new THREE.Vector3(0, -0.6, -40), heading: Math.PI, speed: 0, ph: 0, float: -0.6,
    dive: 0, big: false, hitT: 0, bask: false, slide: 0, charge: 0, chargeCd: 0, bellowT: 10, parked: true, towed: false,
  };
  const gators = Object.assign(Object.create(Gators.prototype), {
    T: { heightAt: () => -2 }, list: [gator], rand: () => 0.5, calm: true, activity: 0, audio: null,
    eyeshinePool: { update(...args) { lightState = args; } },
  });

  gators.update(1, 2, 0, 0, 0, 0, true, 1, 0.25, 0.1, 0.4);
  assert.ok(gator.pos.y > -0.25 && gator.pos.y < -0.19);
  assert.equal(gator.surfaced, true);
  assert.equal(lightState[0], gators.list);
  assert.deepEqual(lightState.slice(1), [2, 0, 0, 0, true, 1, 0.25, 0.1]);
});

test('alligator eyeshine needs darkness, the real spotlight cone and a visible animal face', () => {
  assert.equal(alligatorEyeshineExposure(40, 1, 1, 1, false, true), 0);
  assert.equal(alligatorEyeshineExposure(40, 1, 1, 0, true, true), 0);
  assert.equal(alligatorEyeshineExposure(40, Math.cos(0.4), 1, 1, true, true), 0);
  assert.equal(alligatorEyeshineExposure(40, 1, -1, 1, true, true), 0);
  assert.equal(alligatorEyeshineExposure(40, 1, 1, 1, true, false), 0);
  assert.equal(alligatorEyeshineExposure(40, 1, 1, 1, true, true, 0, 0, 0), 0);
  assert.equal(alligatorEyeshineExposure(109, 1, 1, 1, true, true), 0);
  assert.ok(alligatorEyeshineExposure(40, 1, 1, 1, true, true) > 0.99);
});

test('dense fog shortens the useful eyeshine range without making it brighter', () => {
  const clear = alligatorEyeshineExposure(72, 1, 1, 1, true, true, 0, 0, 1);
  const fog = alligatorEyeshineExposure(72, 1, 1, 1, true, true, 1, 0, 1);
  const storm = alligatorEyeshineExposure(72, 1, 1, 1, true, true, 0, 1, 1);
  assert.ok(clear > fog && clear > storm);
  assert.equal(alligatorEyeshineExposure(90, 1, 1, 1, true, true, 1, 0, 1), 0);
});

test('one fixed instanced pool carries both eyes and vanishes with the spotlight', () => {
  const pool = new GatorEyeshinePool(2), matrices = pool.mesh.instanceMatrix.array, colors = pool.mesh.instanceColor.array;
  const gator = {
    pos: new THREE.Vector3(0, -0.6, -40), heading: Math.PI, ph: 0, surfaced: true, bask: false, towed: false, dive: 0,
    mesh: { visible: true, scale: new THREE.Vector3(1, 1, 1) },
  };

  assert.equal(pool.update([gator], 0, 0, 0, 0, true, 1, 0, 0), 2);
  assert.equal(pool.mesh.count, 2);
  assert.equal(pool.mesh.visible, true);
  assert.equal(pool.resourceStats().drawCalls, 1);
  assert.equal(pool.resourceStats().instanceBytes, 304);

  const first = new THREE.Matrix4(), second = new THREE.Matrix4(), firstPosition = new THREE.Vector3(), secondPosition = new THREE.Vector3();
  pool.mesh.getMatrixAt(0, first); pool.mesh.getMatrixAt(1, second);
  firstPosition.setFromMatrixPosition(first); secondPosition.setFromMatrixPosition(second);
  assert.ok(Math.abs(firstPosition.x - 0.16) < 1e-6);
  assert.ok(Math.abs(secondPosition.x + 0.16) < 1e-6);
  assert.ok(Math.abs(firstPosition.y + 0.1) < 1e-6);
  assert.ok(firstPosition.z > gator.pos.z && secondPosition.z > gator.pos.z);

  const writes = pool.resourceStats().matrixWrites;
  assert.equal(pool.update([gator], 1, 0, 0, 0, false, 1, 0, 0), 0);
  assert.equal(pool.mesh.visible, false);
  assert.equal(pool.resourceStats().drawCalls, 0);
  assert.equal(pool.resourceStats().matrixWrites, writes);
  assert.equal(pool.mesh.instanceMatrix.array, matrices);
  assert.equal(pool.mesh.instanceColor.array, colors);
  assert.deepEqual(
    { capacity: pool.resourceStats().capacity, geometries: pool.resourceStats().geometries, materials: pool.resourceStats().materials, textures: pool.resourceStats().textures, pointLights: pool.resourceStats().pointLights },
    { capacity: 4, geometries: 1, materials: 1, textures: 0, pointLights: 0 },
  );
  pool.dispose();
});

test('submerged and back-facing animals do not consume instance slots', () => {
  const pool = new GatorEyeshinePool(1), gator = {
    pos: new THREE.Vector3(0, -0.6, -32), heading: 0, ph: 0, surfaced: true, bask: false, towed: false, dive: 0,
    mesh: { visible: true, scale: new THREE.Vector3(1, 1, 1) },
  };
  assert.equal(pool.update([gator], 0, 0, 0, 0, true, 1, 0, 0), 0);
  gator.heading = Math.PI; gator.dive = 1;
  assert.equal(pool.update([gator], 0, 0, 0, 0, true, 1, 0, 0), 0);
  gator.dive = 0; gator.surfaced = false;
  assert.equal(pool.update([gator], 0, 0, 0, 0, true, 1, 0, 0), 0);
  pool.dispose();
});
