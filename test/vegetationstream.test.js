import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { crossedFoliageCardGeometry, foliageInstanceCount, normalizeFoliageDetail, Vegetation } from '../src/vegetation.js';

function deferredVegetation(chunks) {
  const terrain = {
    chunks: new Map(chunks.map(chunk => [chunk.key, chunk])),
    normalAt(x, z, out) { return out.set(0, 1, 0); },
  };
  return Object.assign(Object.create(Vegetation.prototype), {
    terrain, exclusions: [], kinds: [], solid: [], solidRevision: 0, detail: 1,
    solidRefreshQueue: [], solidRefreshQueued: new Set(),
    _m: new THREE.Matrix4(), _q: new THREE.Quaternion(), _e: new THREE.Euler(),
    _s: new THREE.Vector3(), _p: new THREE.Vector3(), _normal: new THREE.Vector3(), _col: new THREE.Color(),
    _tint: new THREE.Color(), _crown: new THREE.Vector4(), _hsl: { h: 0, s: 0, l: 0 },
    cypTint: new THREE.Color(0.36, 0.48, 0.26), oakTint: new THREE.Color(0.30, 0.42, 0.25), palmTint: new THREE.Color(0.42, 0.55, 0.34),
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

function recordingBatch() {
  return {
    n: 0, sums: new Float64Array(3),
    add(matrix, color, crown) {
      this.n++;
      for (let i = 0; i < matrix.elements.length; i++) this.sums[0] += matrix.elements[i] * (i + 1);
      if (color) this.sums[1] += color.r * 3 + color.g * 5 + color.b * 7;
      if (crown) this.sums[2] += crown.x * 3 + crown.y * 5 + crown.z * 7 + crown.w * 11;
    },
  };
}

function compactKind(hasCrown = false) {
  return {
    geo: new THREE.PlaneGeometry(1, 1),
    mat: new THREE.MeshBasicMaterial(),
    depth: new THREE.MeshDepthMaterial(),
    opts: { hasCrown }, shadow: false, small: false,
  };
}

function compactChunkVegetation() {
  const vegetation = deferredVegetation([]);
  Object.assign(vegetation.terrain, {
    hf: { compute: () => 0.25 }, island: { x: 9000, y: 9000 }, lagoon: { x: 0, y: 0 },
    riverCenterX: () => 20,
  });
  vegetation.cyp = compactKind(true); vegetation.oak = compactKind(true); vegetation.palm = compactKind();
  vegetation.palmetto = compactKind(); vegetation.moss = compactKind(); vegetation.grass = compactKind(); vegetation.reed = compactKind();
  vegetation.trunkGeo = new THREE.BoxGeometry(1, 1, 1); vegetation.branchGeo = new THREE.BoxGeometry(1, 1, 1); vegetation.kneeGeo = new THREE.BoxGeometry(1, 1, 1);
  vegetation.trunkMat = new THREE.MeshBasicMaterial(); vegetation.branchMat = new THREE.MeshBasicMaterial(); vegetation.kneeMat = new THREE.MeshBasicMaterial();
  const chunk = {
    key: '0:40:40', level: 0, x0: 4000, z0: 4000, size: 100, minH: 0.25, maxH: 0.25,
    h: new Float32Array([0.25]), bio: new Float32Array([0.2]), colliders: [], sample: () => 0.25,
  };
  const stream = vegetation.buildChunk(chunk); let step;
  do step = stream.next(); while (!step.done);
  return { vegetation, chunk };
}

function populateStreamingCell(interleaveScratch = false, tier = 0) {
  const vegetation = deferredVegetation([]);
  Object.assign(vegetation.terrain, {
    hf: { compute: () => 0.25 }, island: { x: 5000, y: 5000 }, lagoon: { x: 0, y: 0 },
    riverCenterX: () => 20,
  });
  const chunk = { level: tier, x0: 0, z0: -100, size: 100, bio: new Float32Array([0.2]), colliders: [], sample: () => 0.25 };
  const batches = Object.fromEntries(['cyp', 'oak', 'palm', 'palmetto', 'moss', 'grass', 'reed', 'trunks', 'branches', 'knees'].map(name => [name, recordingBatch()]));
  const stream = vegetation.populateCell(chunk, 0, -1, tier, batches);
  let yields = 0, step;
  do {
    step = stream.next();
    if (!step.done) {
      yields++;
      if (interleaveScratch) {
        vegetation._m.makeScale(9, 8, 7); vegetation._q.set(0.2, 0.3, 0.4, 0.5); vegetation._e.set(1, 2, 3);
        vegetation._s.set(6, 5, 4); vegetation._p.set(3000, 2000, 1000); vegetation._normal.set(1, 0, 0);
        vegetation._col.set(0xff00ff); vegetation._tint.set(0x00ffff); vegetation._crown.set(9, 8, 7, 6);
      }
    }
  } while (!step.done);
  return {
    yields,
    colliders: chunk.colliders.map(collider => ({ ...collider })),
    batches: Object.fromEntries(Object.entries(batches).map(([name, batch]) => [name, { n: batch.n, sums: [...batch.sums] }])),
  };
}

test('foliage detail keeps silhouettes bounded while reducing retained cards', () => {
  assert.deepEqual([normalizeFoliageDetail(-2), normalizeFoliageDetail(0.56), normalizeFoliageDetail(4), normalizeFoliageDetail('bad')], [0.25, 0.56, 1, 1]);
  assert.deepEqual([0.36, 0.56, 0.82, 1].map(detail => foliageInstanceCount(100, detail, 12)), [36, 56, 82, 100]);
  assert.equal(foliageInstanceCount(5, 0.25, 2), 2);
  assert.equal(foliageInstanceCount(0, 0.5, 2), 0);
});

test('ground cover bakes the same crossed silhouette into one shared geometry', () => {
  const crossed = crossedFoliageCardGeometry();
  assert.equal(crossed.getAttribute('position').count, 8);
  assert.equal(crossed.getAttribute('uv').count, 8);
  assert.equal(crossed.index.count, 12);
  crossed.computeBoundingBox();
  assert.deepEqual(crossed.boundingBox.min.toArray(), [-0.5, 0, -0.5]);
  assert.deepEqual(crossed.boundingBox.max.toArray(), [0.5, 1, 0.5]);
  crossed.dispose();
});

test('chunk-local half-float foliage positions preserve the large world without duplicate 32-bit coordinates', () => {
  const { chunk } = compactChunkVegetation();
  assert.deepEqual(chunk.veg.position.toArray(), [4050, 0, 4050]);

  const compactMeshes = chunk.veg.children.filter(mesh => mesh.geometry.getAttribute('iPosition'));
  assert.ok(compactMeshes.length > 0);
  let instances = 0;
  for (const mesh of compactMeshes) {
    const position = mesh.geometry.getAttribute('iPosition');
    assert.equal(position.isFloat16BufferAttribute, true);
    assert.equal(position.array.BYTES_PER_ELEMENT, 2);
    assert.equal(position.count, mesh.userData.instanceCount);
    instances += position.count;
    for (let i = 0; i < position.count; i++) {
      assert.ok(Math.abs(position.getX(i)) < 90);
      assert.ok(Math.abs(position.getZ(i)) < 90);
    }
  }
  assert.ok(instances > 100);

  const solid = chunk.veg.children.find(mesh => mesh.isInstancedMesh);
  assert.ok(solid);
  const matrix = new THREE.Matrix4(), local = new THREE.Vector3();
  solid.getMatrixAt(0, matrix); local.setFromMatrixPosition(matrix);
  assert.ok(Math.abs(local.x) < 90 && Math.abs(local.z) < 90);
});

test('dense vegetation cells yield repeatedly without changing placements or collisions', () => {
  const uninterrupted = populateStreamingCell(false), interleaved = populateStreamingCell(true);
  assert.ok(uninterrupted.yields > 40);
  assert.ok(uninterrupted.colliders.length > 0);
  assert.ok(Object.values(uninterrupted.batches).reduce((sum, batch) => sum + batch.n, 0) > 100);
  assert.deepEqual(interleaved, uninterrupted);

  const distant = populateStreamingCell(false, 3);
  assert.ok(distant.yields > 3);
  assert.ok(distant.yields < uninterrupted.yields / 2);
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
