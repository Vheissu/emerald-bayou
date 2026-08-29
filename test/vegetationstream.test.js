import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vegetation } from '../src/vegetation.js';

function deferredVegetation(chunks) {
  const terrain = {
    chunks: new Map(chunks.map(chunk => [chunk.key, chunk])),
    normalAt(x, z, out) { return out.set(0, 1, 0); },
  };
  return Object.assign(Object.create(Vegetation.prototype), {
    terrain, exclusions: [], kinds: [], solid: [], solidRevision: 0,
    solidRefreshQueue: [], solidRefreshQueued: new Set(),
    _m: new THREE.Matrix4(), _q: new THREE.Quaternion(), _e: new THREE.Euler(),
    _s: new THREE.Vector3(), _p: new THREE.Vector3(), _normal: new THREE.Vector3(), _col: new THREE.Color(),
  });
}

function levelZeroChunk(key, x0) {
  return {
    key, level: 0, x0, z0: 4000, size: 100, minH: 0.4, maxH: 0.4,
    h: new Float32Array([0.4]), ready: true, disposed: false, veg: new THREE.Group(),
    solidGrassRevision: 0, sample: () => 0.4,
  };
}

const grassResource = () => ({
  geo: new THREE.PlaneGeometry(0.5, 1),
  mat: new THREE.MeshStandardMaterial({ color: 0x6f8d45 }),
  height: 1,
});

test('retrofits deferred solid grass at one ready chunk per frame', () => {
  const a = levelZeroChunk('a', 4000), b = levelZeroChunk('b', 4100);
  const vegetation = deferredVegetation([a, b]);
  const resource = grassResource();

  assert.equal(vegetation.addSolids([resource]), 1);
  assert.equal(vegetation.solidRefreshQueue.length, 2);

  assert.equal(vegetation.updateSolidChunks(), true);
  assert.equal(a.veg.children.length, 1);
  assert.equal(a.veg.children[0].userData.instanceCount, 34);
  assert.equal(b.veg.children.length, 0);
  assert.equal(vegetation.solidRefreshQueue.length, 1);

  assert.equal(vegetation.updateSolidChunks(), true);
  assert.equal(b.veg.children.length, 1);
  assert.equal(vegetation.solidRefreshQueue.length, 0);
  assert.equal(vegetation.updateSolidChunks(), false);
});

test('replaces compact grass upgrades without duplicating meshes or disposing shared source buffers', () => {
  const chunk = levelZeroChunk('a', 4000);
  const vegetation = deferredVegetation([chunk]);
  const first = grassResource(), second = grassResource();

  vegetation.addSolids([first]); vegetation.updateSolidChunks();
  const oldMesh = chunk.veg.children[0]; let compactDisposals = 0;
  oldMesh.geometry.dispose = () => { compactDisposals++; };
  const sharedPosition = first.geo.getAttribute('position');

  vegetation.addSolids([second]); vegetation.updateSolidChunks();

  assert.equal(compactDisposals, 1);
  assert.equal(chunk.veg.children.length, 2);
  assert.equal(chunk.solidGrassRevision, 2);
  assert.equal(first.geo.getAttribute('position'), sharedPosition);
});
