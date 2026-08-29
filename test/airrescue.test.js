import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeAirRescueRig, setAirRescueRole } from '../src/airrescue.js';

function resources(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  return { geometries, materials };
}

test('enforcement and rescue roles reuse one helicopter resource set', () => {
  const scene = new THREE.Scene(), rig = makeAirRescueRig(() => 0.5, scene);
  const before = resources(scene), primary = rig.livery.primary, stripe = rig.livery.stripe, strobe = rig.livery.strobe;

  setAirRescueRole(rig, 'enforcement');
  const enforcement = resources(scene);
  assert.equal(rig.role, 'enforcement');
  assert.equal(rig.root.name, 'FWC aviation helicopter');
  assert.equal(primary.color.getHex(), 0x2d5c4b);
  assert.equal(stripe.color.getHex(), 0xdde7df);
  assert.equal(strobe.color.getHex(), 0x267cff);
  assert.deepEqual(enforcement.geometries, before.geometries);
  assert.deepEqual(enforcement.materials, before.materials);
  assert.equal(rig.livery.primary, primary);
  assert.equal(rig.livery.stripe, stripe);
  assert.equal(rig.livery.strobe, strobe);

  setAirRescueRole(rig, 'rescue');
  assert.equal(rig.role, 'rescue');
  assert.equal(rig.root.name, 'Coast Guard rescue helicopter');
  assert.equal(primary.color.getHex(), 0xe94d20);
  assert.equal(stripe.color.getHex(), 0xe7ecea);
  assert.equal(strobe.color.getHex(), 0xffffff);
});
