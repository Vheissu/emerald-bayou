import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModelBoatFallback } from '../src/npc.js';
import { configureModelLoading, spawn } from '../src/models.js';

const meshes = root => {
  const result = [];
  root.traverse(object => { if (object.isMesh) result.push(object); });
  return result;
};

test('low-tier model boats reuse one compact four-draw procedural resource set', () => {
  const beau = buildModelBoatFallback('beau_boat');
  const sandbox = buildModelBoatFallback('sandbox_boat');
  const cruiser = buildModelBoatFallback('boat_dreams');
  const variants = [beau, sandbox, cruiser].map(meshes);

  for (const variant of variants) {
    assert.equal(variant.length, 4);
    assert.ok(variant.every(mesh => mesh.material.map == null));
  }
  for (let index = 0; index < variants[0].length; index++) {
    assert.equal(variants[0][index].geometry, variants[1][index].geometry);
    assert.equal(variants[0][index].geometry, variants[2][index].geometry);
    assert.equal(variants[0][index].material, variants[1][index].material);
    assert.equal(variants[0][index].material, variants[2][index].material);
  }
  assert.deepEqual([beau.userData.fallbackModel, sandbox.userData.fallbackModel, cruiser.userData.fallbackModel], ['beau_boat', 'sandbox_boat', 'boat_dreams']);
});

test('the cruiser stand-in keeps the longest and widest silhouette without new geometry', () => {
  const beau = buildModelBoatFallback('beau_boat'), sandbox = buildModelBoatFallback('sandbox_boat'), cruiser = buildModelBoatFallback('boat_dreams');
  const beauSize = new THREE.Box3().setFromObject(beau).getSize(new THREE.Vector3());
  const sandboxSize = new THREE.Box3().setFromObject(sandbox).getSize(new THREE.Vector3());
  const cruiserSize = new THREE.Box3().setFromObject(cruiser).getSize(new THREE.Vector3());

  assert.ok(cruiserSize.x > beauSize.x && cruiserSize.z > beauSize.z);
  assert.ok(beauSize.x > sandboxSize.x && beauSize.z > sandboxSize.z);
  assert.ok(cruiserSize.z > 5);
});

test('a disabled cosmetic GLB leaves its procedural hull in the live wrapper', async () => {
  configureModelLoading({ deferOptional: true, disabled: ['beau_boat'] });
  const fallback = buildModelBoatFallback('beau_boat'), wrapper = spawn('beau_boat', fallback);
  await Promise.resolve();
  assert.equal(wrapper.children.includes(fallback), true);
  assert.equal(wrapper.userData.model, undefined);
});
