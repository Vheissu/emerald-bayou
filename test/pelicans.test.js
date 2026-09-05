import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Birds } from '../src/wildlife.js';
import { PelicanFlock, pelicanFlightPose } from '../src/pelicans.js';

function sourceBird() {
  const geometry = new THREE.BoxGeometry();
  geometry.morphAttributes.position = Array.from({ length: 3 }, () => geometry.attributes.position.clone());
  geometry.morphAttributes.normal = Array.from({ length: 3 }, () => geometry.attributes.normal.clone());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.morphTargetDictionary = { Upstroke: 0, Downstroke: 1, Dive: 2 };
  return mesh;
}
function disposeBirds(birds, source = null) {
  birds.pelicans?.dispose(); birds.mesh.geometry.dispose(); birds.mesh.material.dispose(); birds.mesh.dispose();
  source?.geometry.dispose(); source?.material.dispose();
}

test('pelican flight alternates deep strokes and glides without conflicting pose weights', () => {
  const target = new Float32Array(3); let glides = 0, strokes = 0;
  for (let i = 0; i < 1200; i++) {
    assert.equal(pelicanFlightPose(i / 60, 0.7, 0, target), target);
    assert.ok(target.every(v => v >= 0 && v <= 1));
    assert.equal(target[0] * target[1], 0);
    assert.equal(target[2], 0);
    if (target[0] + target[1] < 0.02) glides++;
    if (target[0] + target[1] > 0.85) strokes++;
  }
  assert.ok(glides > 100 && strokes > 30);
  assert.deepEqual([...pelicanFlightPose(2, 0.7, 1, target)], [0, 0, 1]);
  pelicanFlightPose(2, 0.7, 0.7, target);
  assert.ok(target.reduce((sum, v) => sum + v, 0) <= 1.000001);
});

test('ten authored pelicans retain one draw, one pose buffer and the shared model resources', () => {
  const source = sourceBird(), pool = new PelicanFlock(source);
  const matrix = new THREE.Matrix4().makeTranslation(3, 4, 5), matrices = pool.mesh.instanceMatrix.array;
  const texture = pool.mesh.morphTexture, poses = texture.source.data.data, sample = pool.pose.morphTargetInfluences;
  for (let frame = 0; frame < 100; frame++) {
    pool.beginFrame();
    for (let i = 0; i < 10; i++) pool.setBird(i, matrix, frame / 60, i * 0.3, 0, i !== 9);
    pool.finishFrame();
  }
  assert.equal(pool.mesh.instanceMatrix.array, matrices); assert.equal(pool.mesh.morphTexture, texture);
  assert.equal(texture.source.data.data, poses); assert.equal(pool.pose.morphTargetInfluences, sample);
  assert.equal(pool.mesh.geometry, source.geometry); assert.equal(pool.mesh.material, source.material);
  assert.equal(pool.mesh.count, 10); assert.equal(pool.resourceStats().drawCalls, 1);
  assert.equal(pool.resourceStats().poseUploadBytes, 160);
  assert.equal(pool.resourceStats().activeBirds, 9);
  pool.mesh.getMatrixAt(9, matrix); assert.equal(matrix.elements[0], 0);
  pool.beginFrame(); pool.finishFrame(); assert.equal(pool.resourceStats().drawCalls, 0);
  let sharedDisposals = 0;
  source.geometry.addEventListener('dispose', () => sharedDisposals++); source.material.addEventListener('dispose', () => sharedDisposals++);
  pool.dispose(); assert.equal(sharedDisposals, 0);
  source.geometry.dispose(); source.material.dispose();
});

test('authored pelicans replace existing slots only after the real morph draw has compiled', async () => {
  const birds = new Birds(null), source = sourceBird(), root = new THREE.Group(); root.add(source);
  let finishWarm, warmed = null, requests = 0;
  const gate = new Promise(resolve => { finishWarm = resolve; });
  const prepare = async mesh => { warmed = mesh; await gate; };
  const load = async name => { assert.equal(name, 'brown_pelican'); requests++; return root; };
  const loading = birds.loadPelicans(prepare, load);
  assert.equal(birds.loadPelicans(prepare, load), loading);
  await Promise.resolve();
  assert.equal(warmed.isInstancedMesh, true); assert.ok(warmed.morphTexture); assert.equal(warmed.count, 10);
  assert.equal(birds.pelicans, null); assert.equal(birds.mesh.children.length, 0);
  finishWarm(); assert.equal(await loading, true); assert.equal(requests, 1);
  birds.update(4, { x: 0, z: 0 });
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < birds.count; i++) {
    const b = birds.birds[i]; birds.mesh.getMatrixAt(i, matrix);
    if (b.pelicanSlot >= 0) {
      assert.equal(matrix.elements[0], 0);
      birds.pelicans.mesh.getMatrixAt(b.pelicanSlot, matrix);
      assert.ok(new THREE.Vector3().setFromMatrixScale(matrix).length() > 1);
    }
  }
  assert.equal(birds.resourceStats().birdCapacity, 77);
  assert.equal(birds.resourceStats().drawCalls, 2);
  birds.activity = 0; birds.setFeedingActivity({ active: true, intensity: 1, x: 0, z: 0 });
  for (let i = 0; i < 90; i++) birds.update(i / 60, { x: 0, z: 0 });
  assert.ok(birds.flocks.filter(f => f.feedingRole).every(f => f.feedBlend > 0));
  assert.equal(birds.pelicans.mesh, warmed); assert.equal(birds.pelicans.capacity, 10);
  disposeBirds(birds, source);
});

test('missing authored wildlife leaves a complete procedural flock', async () => {
  const birds = new Birds(null);
  assert.equal(await birds.loadPelicans(null, async () => null), false);
  assert.equal(birds.pelicanLoadState, 'unavailable'); assert.equal(birds.pelicans, null);
  birds.update(1, { x: 0, z: 0 });
  const matrix = new THREE.Matrix4(); birds.mesh.getMatrixAt(40, matrix);
  assert.ok(new THREE.Vector3().setFromMatrixScale(matrix).length() > 1);
  disposeBirds(birds);
});

test('a failed shader preparation disposes only the detached flock and preserves the fallback', async t => {
  const birds = new Birds(null), source = sourceBird(), root = new THREE.Group(); root.add(source);
  t.mock.method(console, 'warn', () => {});
  let instances = 0, textures = 0, shared = 0;
  source.geometry.addEventListener('dispose', () => shared++); source.material.addEventListener('dispose', () => shared++);
  const ready = await birds.loadPelicans(async mesh => {
    mesh.addEventListener('dispose', () => instances++);
    mesh.morphTexture.addEventListener('dispose', () => textures++);
    throw new Error('test compiler failure');
  }, async () => root);
  assert.equal(ready, false); assert.equal(birds.pelicanLoadState, 'failed');
  assert.equal(birds.pelicans, null); assert.equal(birds.mesh.children.length, 0);
  assert.equal(instances, 1); assert.equal(textures, 1); assert.equal(shared, 0);
  disposeBirds(birds, source);
});

test('bird noses point along the flight path and the flock uses metre-scale wingspans', () => {
  const birds = new Birds(null), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), after = new THREE.Vector3();
  birds.update(4, { x: 0, z: 0 }); birds.mesh.getMatrixAt(40, matrix);
  position.setFromMatrixPosition(matrix);
  const forward = new THREE.Vector3(0, 0, -1).transformDirection(matrix);
  birds.update(4.01, { x: 0, z: 0 }); birds.mesh.getMatrixAt(40, matrix); after.setFromMatrixPosition(matrix);
  assert.ok(forward.dot(after.sub(position).normalize()) > 0.98);
  const scale = Object.fromEntries(birds.flocks.map(f => [f.kind, f.K.scale * 2]));
  assert.deepEqual(scale, { ibis: 1, pelican: 2, vulture: 1.74, swallow: 0.31, osprey: 1.68 });
  const geo = birds.mesh.geometry, wing = geo.attributes.aWing;
  assert.ok([...wing.array].some(v => v === 1)); assert.ok([...wing.array].some(v => v === 0));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader };
  birds.mesh.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /objectNormal.xy = wingRotation/);
  assert.equal(shader.uniforms.uTime, birds.birdTime);
  disposeBirds(birds);
});

test('the shipped Blender export has one textured mesh, morph normals and a bounded geometry budget', () => {
  const buffer = readFileSync(new URL('../public/wildlife/brown-pelican.glb', import.meta.url));
  assert.equal(buffer.readUInt32LE(0), 0x46546c67);
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
  assert.equal(json.meshes.length, 1); assert.equal(json.meshes[0].primitives.length, 1);
  const mesh = json.meshes[0], primitive = mesh.primitives[0], bounds = json.accessors[primitive.attributes.POSITION];
  assert.deepEqual(mesh.extras.targetNames, ['Upstroke', 'Downstroke', 'Dive']);
  assert.equal(primitive.targets.length, 3);
  assert.ok(primitive.targets.every(p => p.POSITION !== undefined && p.NORMAL !== undefined));
  assert.ok(primitive.attributes.COLOR_0 !== undefined && primitive.attributes.TEXCOORD_0 !== undefined);
  assert.equal(json.images.length, 1); assert.equal(json.images[0].mimeType, 'image/jpeg');
  assert.ok(json.materials[0].pbrMetallicRoughness.baseColorTexture);
  assert.ok(json.accessors[primitive.indices].count / 3 <= 4500);
  assert.ok(buffer.length < 650000);
  assert.ok(bounds.max[0] - bounds.min[0] > 2 && bounds.max[0] - bounds.min[0] < 2.1);
  assert.ok(bounds.min[2] < -0.75 && bounds.max[2] > 0.35, 'head faces -Z in the shipped asset');
});

test('the actual exported poses lift and fold the wings while leaving the head and bill rigid', async () => {
  const buffer = readFileSync(new URL('../public/wildlife/brown-pelican.glb', import.meta.url));
  const loader = new GLTFLoader();
  // Decode the real geometry with Three. Image decoding itself is checked in the browser.
  loader.register(() => ({ name: 'TEST_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  const source = gltf.scene.children[0], geo = source.geometry, positions = geo.attributes.position;
  assert.equal(geo.morphTargetsRelative, true);
  let rigid = 0, wing = 0;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    for (const attr of [...geo.morphAttributes.position, ...geo.morphAttributes.normal]) {
      assert.ok([attr.getX(i), attr.getY(i), attr.getZ(i)].every(Number.isFinite));
    }
    if (z < -0.3) {
      rigid++;
      for (const attr of geo.morphAttributes.position) assert.ok(Math.hypot(attr.getX(i), attr.getY(i), attr.getZ(i)) < 1e-6);
    }
    if (Math.abs(x) > 0.65) {
      wing++;
      assert.ok(geo.morphAttributes.position[0].getY(i) > 0.2);
      assert.ok(geo.morphAttributes.position[1].getY(i) < -0.1);
      assert.ok(Math.abs(x + geo.morphAttributes.position[2].getX(i)) < Math.abs(x) * 0.6);
    }
  }
  assert.ok(rigid > 100 && wing > 100);
  source.material.map.dispose(); geo.dispose(); source.material.dispose();
});
