import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cacheStaticWorldTransforms, SceneTransformCache } from '../src/scenetransforms.js';
import { configureModelLoading } from '../src/models.js';
import { gatorMesh } from '../src/wildlife.js';

test('cached terrain keeps the exact attached world transform and avoids repeated matrix arithmetic', () => {
  const scene = new THREE.Scene(), terrain = new THREE.Group(), chunk = new THREE.Group();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(geometry, material);
  chunk.position.set(1250, 0, -950); mesh.position.set(2, 3, -4); mesh.rotation.set(0.1, 0.3, 0.2);
  mesh.scale.set(0.7, 1.4, 1.2); chunk.add(mesh); terrain.add(chunk); scene.add(terrain); scene.updateMatrixWorld(true);
  const expected = mesh.matrixWorld.clone(), before = new THREE.Box3().setFromObject(mesh);
  const vertices = geometry.attributes.position.array;
  assert.equal(cacheStaticWorldTransforms(chunk), 2);
  let compositions = 0, multiplications = 0;
  mesh.matrix.compose = () => { compositions++; throw new Error('static local matrix was recomputed'); };
  mesh.matrixWorld.multiplyMatrices = () => { multiplications++; throw new Error('static world matrix was recomputed'); };
  for (let i = 0; i < 120; i++) scene.updateMatrixWorld();
  assert.deepEqual(mesh.matrixWorld.elements, expected.elements);
  assert.ok(new THREE.Box3().setFromObject(mesh).equals(before));
  assert.equal(geometry.attributes.position.array, vertices);
  assert.equal(compositions, 0); assert.equal(multiplications, 0);
  geometry.dispose(); material.dispose();
});

test('late grass replacements receive the existing chunk origin before being cached', () => {
  const scene = new THREE.Scene(), chunk = new THREE.Group(); chunk.position.set(-750, 0, 450); scene.add(chunk);
  cacheStaticWorldTransforms(chunk);
  const grass = new THREE.Object3D(); grass.position.set(0.125, 0.6, -0.25); chunk.add(grass);
  cacheStaticWorldTransforms(grass); scene.updateMatrixWorld(true);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(grass.matrixWorld).toArray(), [-749.875, 0.6, 449.75]);
});

test('inactive pooled rigs skip descendants and refresh every transform when shown again', () => {
  const scene = new THREE.Scene(), rig = new THREE.Group(), joint = new THREE.Object3D();
  rig.add(joint); scene.add(rig); const cache = new SceneTransformCache(scene);
  scene.updateMatrixWorld();
  let visits = 0; const update = joint.updateMatrixWorld;
  joint.updateMatrixWorld = function (force) { visits++; return update.call(this, force); };
  rig.visible = false; rig.position.x = 8; joint.position.y = 3;
  for (let i = 0; i < 60; i++) scene.updateMatrixWorld();
  assert.equal(visits, 0); assert.equal(cache.stats.skippedBranches, 60);
  rig.visible = true; scene.updateMatrixWorld();
  assert.equal(visits, 1);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(joint.matrixWorld).toArray(), [8, 3, 0]);
  cache.dispose();
});

test('hidden rigs still honour explicit forced updates and on-demand position queries', () => {
  const scene = new THREE.Scene(), rig = new THREE.Group(), child = new THREE.Object3D();
  rig.add(child); scene.add(rig); const cache = new SceneTransformCache(scene); scene.updateMatrixWorld();
  rig.visible = false; rig.position.set(7, 8, 9); child.position.set(1, 2, 3);
  scene.updateMatrixWorld();
  assert.deepEqual(child.getWorldPosition(new THREE.Vector3()).toArray(), [8, 10, 12]);
  rig.position.x = 11; scene.updateMatrixWorld(true);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).toArray(), [12, 10, 12]);
  cache.dispose();
});

test('registration follows scene ownership and restores custom update methods on removal', () => {
  const scene = new THREE.Scene(), cache = new SceneTransformCache(scene), rig = new THREE.Group();
  let delegated = 0;
  const original = function (force) { delegated++; THREE.Group.prototype.updateMatrixWorld.call(this, force); };
  rig.updateMatrixWorld = original; scene.add(rig);
  assert.equal(cache.stats.registered, 1); assert.notEqual(rig.updateMatrixWorld, original);
  scene.updateMatrixWorld(); assert.equal(delegated, 1);
  scene.remove(rig); assert.equal(rig.updateMatrixWorld, original); assert.equal(cache.stats.registered, 0);
  scene.add(rig); cache.dispose(); assert.equal(rig.updateMatrixWorld, original); assert.equal(scene.matrixAutoUpdate, true);
  assert.equal(cache.stats.registered, 0);
});

test('fallback alligator batching retains every scute and leg in eight shared draws', () => {
  configureModelLoading({ disabled: ['realistic_alligator'] });
  const first = gatorMesh(), second = gatorMesh(1.4), body = first.children[0], other = second.children[0];
  assert.equal(body.userData.batchedDraws, 21); assert.equal(body.children.length, 8);
  assert.deepEqual(body.children.filter(mesh => mesh.isInstancedMesh).map(mesh => mesh.count).sort((a, b) => a - b), [2, 4, 18]);
  assert.ok(body.children.every(mesh => mesh.castShadow && mesh.receiveShadow));
  body.children.forEach((mesh, i) => { assert.equal(mesh.geometry, other.children[i].geometry); assert.equal(mesh.material, other.children[i].material); });
  const scene = new THREE.Scene(); scene.add(first); first.position.set(5, 1, -7); first.rotation.y = 0.4; scene.updateMatrixWorld();
  const before = new THREE.Box3().setFromObject(first); first.position.x += 10; scene.updateMatrixWorld();
  const after = new THREE.Box3().setFromObject(first);
  assert.ok(Math.abs(after.min.x - before.min.x - 10) < 1e-6);
  assert.ok(Math.abs(after.max.x - before.max.x - 10) < 1e-6);
  first.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); second.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
});
