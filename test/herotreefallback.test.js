import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { heroTreeFallback } from '../src/markers.js';
import { configureModelLoading, spawn } from '../src/models.js';

const meshes = root => {
  const result = [];
  root.traverse(object => { if (object.isMesh) result.push(object); });
  return result;
};

const triangles = geometry => (geometry.index?.count || geometry.getAttribute('position').count) / 3;

test('hero-tree stand-ins share a compact two-draw resource set', () => {
  const first = heroTreeFallback(), second = heroTreeFallback();
  const firstMeshes = meshes(first), secondMeshes = meshes(second);

  assert.equal(firstMeshes.length, 2);
  assert.equal(secondMeshes.length, 2);
  for (let index = 0; index < firstMeshes.length; index++) {
    assert.equal(firstMeshes[index].geometry, secondMeshes[index].geometry);
    assert.equal(firstMeshes[index].material, secondMeshes[index].material);
  }
  assert.ok(firstMeshes.reduce((total, mesh) => total + triangles(mesh.geometry), 0) < 800);
  assert.ok(firstMeshes.every(mesh => mesh.material.map == null));
  assert.equal(first.userData.fallbackModel, 'tree_c');
});

test('the compact live oak preserves the authored hero-tree silhouette', () => {
  const size = new THREE.Box3().setFromObject(heroTreeFallback()).getSize(new THREE.Vector3());
  assert.ok(size.x > 8 && size.x < 13);
  assert.ok(size.y > 11 && size.y < 14);
  assert.ok(size.z > 5 && size.z < 9);
});

test('a disabled hero-tree GLB leaves its procedural tree in the live wrapper', async () => {
  configureModelLoading({ deferOptional: true, disabled: ['tree_c'] });
  const fallback = heroTreeFallback(), wrapper = spawn('tree_c', fallback);
  await Promise.resolve();
  assert.equal(wrapper.children.includes(fallback), true);
  assert.equal(wrapper.userData.model, undefined);
});
