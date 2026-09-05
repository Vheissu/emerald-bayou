import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { instanceStaticChildren } from '../src/staticinstances.js';

test('repeated boat structure keeps its geometry and exact local transforms in one draw', () => {
  const root = new THREE.Group(), geo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6), mat = new THREE.MeshStandardMaterial();
  const originals = [];
  for (let i = 0; i < 30; i++) {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(Math.sin(i), 1, Math.cos(i)); mesh.rotation.z = i * 0.2;
    mesh.scale.y = 0.7 + i * 0.03; mesh.castShadow = true; mesh.receiveShadow = true; mesh.updateMatrix();
    originals.push(mesh.matrix.clone()); root.add(mesh);
  }
  assert.equal(instanceStaticChildren(root), 29);
  assert.equal(root.children.length, 1);
  const batch = root.children[0], matrix = new THREE.Matrix4();
  assert.equal(batch.geometry, geo); assert.equal(batch.material, mat); assert.equal(batch.count, 30);
  assert.equal(batch.castShadow, true); assert.equal(batch.receiveShadow, true);
  assert.ok(batch.boundingSphere.radius > 1);
  for (let i = 0; i < batch.count; i++) {
    batch.getMatrixAt(i, matrix);
    matrix.elements.forEach((value, j) => assert.ok(Math.abs(value - originals[i].elements[j]) < 1e-6));
  }
  assert.equal(instanceStaticChildren(root), 0);
  geo.dispose(); mat.dispose(); batch.dispose();
});

test('animated pivots, transparent blur and damaged hull surfaces remain independently owned', () => {
  const root = new THREE.Group(), pivot = new THREE.Group(), geo = new THREE.BoxGeometry(), mat = new THREE.MeshStandardMaterial();
  const blurMat = new THREE.MeshBasicMaterial({ transparent: true }), blur = new THREE.Mesh(geo, blurMat);
  const hull = new THREE.Mesh(geo, mat); hull.userData.hullDamageSurface = true;
  pivot.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat));
  root.add(pivot, hull, blur, new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat));
  assert.equal(instanceStaticChildren(root, new Set([pivot])), 1);
  assert.equal(pivot.children.length, 2); assert.equal(pivot.parent, root);
  assert.equal(hull.parent, root); assert.equal(blur.parent, root);
  const batch = root.children.find(child => child.isInstancedMesh);
  root.position.set(3, 2, 8); root.rotation.y = 0.6; root.updateMatrixWorld();
  const clone = root.clone(true), clonedBatch = clone.children.find(child => child.isInstancedMesh);
  assert.equal(clonedBatch.geometry, batch.geometry); assert.equal(clonedBatch.material, batch.material);
  assert.notEqual(clonedBatch.instanceMatrix, batch.instanceMatrix);
  geo.dispose(); mat.dispose(); blurMat.dispose(); batch.dispose(); clonedBatch.dispose();
});
