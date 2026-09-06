import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { crossedFoliageCardGeometry, foliageInstanceCount, foliageRangeVisible, normalizeFoliageDetail, Vegetation } from '../src/vegetation.js';
import { surfaceWetMaterialStats } from '../src/surfacewetness.js';

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

test('deferred grass warms its actual wind and compact-instance shader before any visible upgrade', async () => {
  const chunk = levelZeroChunk('prepared', 4000), vegetation = deferredVegetation([chunk]), resource = grassResource();
  const position = resource.geo.attributes.position;
  let release, warmMesh, disposed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const preparing = vegetation.prepareSolids([resource], async mesh => {
    warmMesh = mesh;
    assert.equal(mesh.geometry.isInstancedBufferGeometry, true);
    assert.equal(mesh.geometry.instanceCount, 1);
    assert.ok(mesh.geometry.attributes.iPosition.isInstancedBufferAttribute);
    assert.equal(mesh.material.side, THREE.FrontSide);
    assert.equal(mesh.receiveShadow, true); assert.equal(mesh.castShadow, false);
    assert.equal(mesh.layers.mask, 2);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    mesh.material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /compactRotate/); assert.match(shader.vertexShader, /windOffset/);
    mesh.geometry.addEventListener('dispose', () => disposed++);
    await gate;
  });
  assert.equal(vegetation.solid.length, 0); assert.equal(vegetation.solidRevision, 0);
  assert.equal(vegetation.solidRefreshQueue.length, 0); assert.equal(disposed, 0);
  release(); assert.equal(await preparing, 1);
  assert.equal(vegetation.solid[0].mat, warmMesh.material);
  assert.equal(vegetation.solidRefreshQueue.length, 1); assert.equal(disposed, 1);
  assert.equal(resource.geo.attributes.position, position);
  assert.deepEqual(vegetation.solidPreparation, { attempted: 1, completed: 1, failed: 0 });
});

test('a failed derived grass shader keeps the existing cards and leaves source buffers intact', async t => {
  t.mock.method(console, 'warn', () => {});
  const vegetation = deferredVegetation([levelZeroChunk('failed', 4000)]), resource = grassResource();
  const registered = surfaceWetMaterialStats().registered;
  let sourceDisposals = 0;
  resource.geo.addEventListener('dispose', () => sourceDisposals++); resource.mat.addEventListener('dispose', () => sourceDisposals++);
  const result = await vegetation.prepareSolids([resource], async () => { throw new Error('test compile failure'); });
  assert.equal(result, 0); assert.equal(vegetation.solid.length, 0); assert.equal(vegetation.solidRefreshQueue.length, 0);
  assert.equal(sourceDisposals, 0);
  assert.equal(surfaceWetMaterialStats().registered, registered);
  assert.deepEqual(vegetation.solidPreparation, { attempted: 1, completed: 0, failed: 1 });
});

test('hero-tree materials receive wind before the loader can warm and expose their shared clones', () => {
  const vegetation = deferredVegetation([]); vegetation.extraMats = [];
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(2, 6, 2), material = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const position = geometry.attributes.position, previousKey = material.customProgramCacheKey();
  assert.equal(vegetation.prepareHeroTree(root, { height: 13, scale: 1 }), 1);
  assert.equal(vegetation.extraMats.length, 1); assert.notEqual(material.customProgramCacheKey(), previousKey);
  assert.match(material.customProgramCacheKey(), /^hero--3-3-/);
  assert.equal(geometry.attributes.position, position);
  assert.ok(root.userData.box instanceof THREE.Box3);
  const clone = root.clone(true); assert.equal(clone.children[0].material, material);
  geometry.dispose(); material.dispose();
});

test('range culling is conservative at corners and half-float position boundaries', () => {
  const range = { minX: 100, maxX: 200, minZ: -50, maxZ: 50, end: 210, padding: 0.25 };
  assert.equal(foliageRangeVisible(range, { x: 150, z: 0 }), true);
  assert.equal(foliageRangeVisible(range, { x: -110.2, z: 0 }), true);
  assert.equal(foliageRangeVisible(range, { x: -110.3, z: 0 }), false);
  for (let x = -150; x <= 450; x += 13) for (let z = -300; z <= 300; z += 17) {
    for (const [px, pz] of [[100, -50], [200, 50], [150, 0], [100, 50], [200, -50]]) {
      if (Math.hypot(x - px, z - pz) < range.end) assert.equal(foliageRangeVisible(range, { x, z }), true);
    }
  }
});

test('solid grass keeps its buffers and placement while leaving and re-entering the existing fade range', () => {
  const chunk = levelZeroChunk('range', 4000), vegetation = deferredVegetation([chunk]);
  vegetation.terrain.visible = new Set([chunk]);
  vegetation.addSolids([grassResource()]); vegetation.updateSolidChunks();
  const mesh = chunk.veg.children[0], geometry = mesh.geometry, positions = geometry.attributes.iPosition.array;
  const range = mesh.userData.foliageRange;
  assert.equal(range.end, 210);
  assert.ok(range.minX >= 4000 && range.maxX <= 4100);
  assert.ok(range.minZ >= 4000 && range.maxZ <= 4100);
  vegetation.updateRangeVisibility({ x: 4050, z: 4050 }); assert.equal(mesh.visible, true);
  vegetation.updateRangeVisibility({ x: 0, z: 0 }); assert.equal(mesh.visible, false);
  assert.equal(vegetation.rangeCulling.culledMeshes, 1); assert.equal(vegetation.rangeCulling.culledInstances, 34);
  vegetation.updateRangeVisibility({ x: 4050, z: 4050 }); assert.equal(mesh.visible, true);
  assert.equal(mesh.geometry, geometry); assert.equal(geometry.attributes.iPosition.array, positions);
  assert.equal(mesh.userData.instanceCount, 34); assert.equal(chunk.solidGrassRevision, 1);
});

test('meshes without an existing non-shadow fade remain visible', () => {
  const chunk = levelZeroChunk('shadow', 4000), vegetation = deferredVegetation([chunk]), tree = new THREE.Object3D();
  tree.castShadow = true; chunk.veg.add(tree); vegetation.terrain.visible = new Set([chunk]);
  vegetation.updateRangeVisibility({ x: -9000, z: 9000 });
  assert.equal(tree.visible, true); assert.equal(vegetation.rangeCulling.eligibleMeshes, 0);
});

test('fully faded instances leave the vertex shader before normal and wind calculations', async () => {
  const vegetation = deferredVegetation([]);
  await vegetation.prepareSolids([grassResource()], async mesh => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    mesh.material.onBeforeCompile(shader);
    const earlyReturn = shader.vertexShader.indexOf('if (compactKeep <= 0.0)');
    assert.ok(earlyReturn > 0 && earlyReturn < shader.vertexShader.indexOf('#include <beginnormal_vertex>'));
    assert.match(shader.vertexShader, /gl_Position = vec4\(2\.0, 2\.0, 2\.0, 1\.0\); return/);
    assert.deepEqual(shader.uniforms.uFade.value.toArray(), [150, 210]);
    const depth = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
    mesh.customDepthMaterial.onBeforeCompile(depth);
    assert.deepEqual(depth.uniforms.uFade.value.toArray(), [1e8, 1e8 + 1]);
  });
});
