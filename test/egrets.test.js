import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EGRET_POSES, EgretFlock, egretPose } from '../src/egrets.js';
import { Waders } from '../src/wildlife.js';

const terrain = { heightAt: () => -0.1 };
function sourceEgret() {
  const geometry = new THREE.BoxGeometry();
  geometry.morphAttributes.position = EGRET_POSES.map(() => geometry.attributes.position.clone());
  geometry.morphAttributes.normal = EGRET_POSES.map(() => geometry.attributes.normal.clone());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  mesh.morphTargetDictionary = Object.fromEntries(EGRET_POSES.map((name, i) => [name, i]));
  return mesh;
}
function close(waders, source) {
  waders.egrets?.dispose(); waders.group.removeFromParent();
  source?.geometry.dispose(); source?.material.dispose();
}
const visibleDraws = group => { let count = 0; group.traverseVisible(o => { if (o.isMesh) count++; }); return count; };
function place(w, x = 8, z = 0) {
  w.x = x; w.z = z; w.y = -0.085; w.mesh.position.set(x, w.y, z); w.mesh.rotation.set(0, 0, 0);
}

test('egret flight is a convex pose blend with separate ground actions', () => {
  const pose = new Float32Array(6);
  for (let i = 0; i < 1000; i++) {
    const flight = (i % 11) / 10;
    assert.equal(egretPose(i / 60, 0.7, flight, 1, 1, pose), pose);
    assert.ok(pose.every(value => value >= 0 && value <= 1));
    assert.ok(Math.abs(pose[0] + pose[1] + pose[2] - flight) < 1e-6);
    assert.equal(pose[1] * pose[2], 0); assert.equal(pose[4] * pose[5], 0);
    if (flight === 1) assert.deepEqual([...pose.slice(3)], [0, 0, 0]);
  }
  egretPose(0, 0, 0, 1, 0, pose);
  assert.deepEqual([...pose], [0, 0, 0, 1, 0, 0]);
});

test('sixteen egrets share one lit draw and retain their matrix and 448-byte pose buffers', () => {
  const source = sourceEgret(), pool = new EgretFlock(source), matrix = new THREE.Matrix4();
  const matrices = pool.mesh.instanceMatrix.array, texture = pool.mesh.morphTexture, data = texture.source.data.data;
  const pose = pool.pose.morphTargetInfluences;
  for (let frame = 0; frame < 100; frame++) {
    pool.beginFrame();
    for (let i = 0; i < 16; i++) pool.setBird(i, matrix.makeTranslation(i, 2, 3), frame / 60, i, 1, 0, 0, i < 12);
    pool.finishFrame();
  }
  assert.equal(pool.mesh.geometry, source.geometry); assert.equal(pool.mesh.material, source.material);
  assert.equal(pool.mesh.instanceMatrix.array, matrices); assert.equal(pool.mesh.morphTexture, texture);
  assert.equal(texture.source.data.data, data); assert.equal(pool.pose.morphTargetInfluences, pose);
  assert.equal(pool.resourceStats().poseUploadBytes, 448); assert.equal(pool.resourceStats().activeBirds, 12);
  assert.equal(pool.resourceStats().drawCalls, 1); assert.equal(pool.mesh.castShadow, true);
  assert.equal(pool.mesh.customDepthMaterial, pool.depth);
  pool.mesh.getMatrixAt(15, matrix); assert.equal(matrix.elements[0], 0);
  pool.beginFrame(); pool.finishFrame(); assert.equal(pool.mesh.visible, false);
  let shared = 0, depth = 0, poses = 0;
  source.geometry.addEventListener('dispose', () => shared++); source.material.addEventListener('dispose', () => shared++);
  pool.depth.addEventListener('dispose', () => depth++); texture.addEventListener('dispose', () => poses++);
  pool.dispose(); assert.deepEqual({ shared, depth, poses }, { shared: 0, depth: 1, poses: 1 });
  source.geometry.dispose(); source.material.dispose();
});

test('the model swap waits for both lit and shadow morph shaders and preserves all resident records', async () => {
  const waders = new Waders(terrain, 16, 0, 0), source = sourceEgret(), root = new THREE.Group(); root.add(source);
  const records = [...waders.list], transforms = waders.list.map(w => w.mesh), materials = [];
  let release, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const preparing = waders.loadEgrets(async mesh => {
    materials.push(mesh.material); assert.ok(mesh.morphTexture); assert.equal(mesh.count, 16);
    if (materials.length === 2) await gate;
  }, async name => { assert.equal(name, 'great_egret'); requests++; return root; });
  assert.equal(waders.loadEgrets(), preparing);
  while (materials.length < 2) await Promise.resolve();
  assert.equal(visibleDraws(waders.group), 112); assert.equal(waders.egrets, null);
  assert.equal(materials[0], source.material); assert.ok(materials[1].isMeshDepthMaterial);
  assert.equal(materials[1].side, THREE.DoubleSide);
  release(); assert.equal(await preparing, true); assert.equal(requests, 1);
  assert.equal(visibleDraws(waders.group), 1); assert.equal(waders.egrets.mesh.material, source.material);
  assert.ok(waders.list.every((w, i) => w === records[i] && w.mesh === transforms[i]));
  const matrix = new THREE.Matrix4(); waders.egrets.mesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - records[0].x) < 1e-5);
  waders.activity = 0; waders.update(0, 0, 0, 0, 0);
  assert.equal(visibleDraws(waders.group), 0);
  close(waders, source);
});

test('a missing model or failed shadow warm-up leaves the complete fallback and releases owned buffers', async t => {
  const missing = new Waders(terrain, 2, 0, 0);
  assert.equal(await missing.loadEgrets(null, async () => null), false);
  assert.equal(missing.egretLoadState, 'unavailable'); assert.equal(visibleDraws(missing.group), 14);
  const waders = new Waders(terrain, 2, 0, 0), source = sourceEgret(), root = new THREE.Group(); root.add(source);
  t.mock.method(console, 'warn', () => {});
  let shared = 0, disposed = 0, depthDisposed = 0;
  source.geometry.addEventListener('dispose', () => shared++); source.material.addEventListener('dispose', () => shared++);
  assert.equal(await waders.loadEgrets(async mesh => {
    if (!mesh.material.isMeshDepthMaterial) mesh.addEventListener('dispose', () => disposed++);
    else { mesh.material.addEventListener('dispose', () => depthDisposed++); throw new Error('test shadow compiler failure'); }
  }, async () => root), false);
  assert.deepEqual({ shared, disposed, depthDisposed }, { shared: 0, disposed: 1, depthDisposed: 1 });
  assert.equal(waders.egretLoadState, 'failed'); assert.equal(visibleDraws(waders.group), 14);
  close(missing); close(waders, source);
});

test('a flushed egret opens its wings and completes landing on the terrain, never suspended at timer expiry', () => {
  const waders = new Waders(terrain, 1, 0, 0), w = waders.list[0]; place(w);
  const objectCount = waders.group.children.length;
  assert.equal(waders.flush(w, 0, 0, 8, 'player'), true);
  assert.equal(w.flightLandable, true);
  let highest = w.y, extended = 0, frames = 0;
  while (w.fly > 0 && frames++ < 600) {
    waders.update(1 / 60, frames / 60, 0, 0, 0, 0);
    highest = Math.max(highest, w.y); if (w.flightBlend > 0.99) extended++;
    assert.ok(w.y >= -0.085 - 1e-8);
  }
  assert.ok(highest > 1.5 && extended > 100); assert.ok(frames < 600);
  assert.equal(w.fly, 0); assert.equal(w.flightBlend, 0);
  assert.ok(Math.abs(w.y - (terrain.heightAt(w.x, w.z) + 0.015)) < 1e-10);
  assert.equal(w.mesh.position.y, w.y); assert.equal(w.mesh.rotation.x, 0);
  assert.equal(waders.group.children.length, objectCount); close(waders);
});

test('paused waders do not flush, walk, advance poses or move a flying resident', () => {
  const waders = new Waders(terrain, 1, 0, 0), w = waders.list[0]; place(w);
  let flushes = 0; waders.onFlush = () => flushes++;
  const ground = w.groundTime;
  waders.update(0, 100, 0, 0, 12, 0);
  assert.equal(flushes, 0); assert.equal(w.fly, 0); assert.equal(w.groundTime, ground); assert.equal(waders.poseTime, 0);
  waders.flush(w, 0, 0, 8); const duration = w.fly, position = w.mesh.position.clone();
  waders.update(0, 200, 0, 0, 12, 0);
  assert.equal(w.fly, duration); assert.ok(w.mesh.position.equals(position)); close(waders);
});

test('the live renderer stops shorebird simulation behind the title and while paused', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /waders\.update\(started && !game\.paused \? dt : 0, time/);
});

test('fallback egrets open shared physical wings during flight and hide them after landing', () => {
  const waders = new Waders(terrain, 2, 0, 0), w = waders.list[0]; place(w);
  const other = waders.list[1];
  assert.equal(w.wings[0].geometry, w.wings[1].geometry);
  assert.equal(w.wings[0].geometry, other.wings[0].geometry);
  assert.ok(w.wings.every(wing => !wing.visible));
  waders.flush(w, 0, 0, 8);
  for (let i = 0; i < 90; i++) waders.update(1 / 60, i / 60, 0, 0, 0, 0);
  assert.ok(w.wings.every(wing => wing.visible)); assert.ok(Math.abs(w.wings[0].rotation.z) > 0.01);
  for (let i = 0; i < 510; i++) waders.update(1 / 60, i / 60, 0, 0, 0, 0);
  assert.ok(w.wings.every(wing => !wing.visible)); close(waders);
});

test('a flooding shelf triggers ambient flight and an invalid landing stays airborne', () => {
  const waders = new Waders(terrain, 1, 0, 0), w = waders.list[0]; place(w);
  const sources = []; waders.onFlush = (bird, d, source) => sources.push(source);
  waders.update(1 / 60, 0, 0, 0, 0, 0.6);
  assert.deepEqual(sources, ['tide']); assert.ok(w.fly > 0); assert.equal(w.flightLandable, false);
  for (let i = 0; i < 600; i++) waders.update(1 / 60, i / 60, w.x + 100, w.z, 0, 0.6);
  assert.ok(w.fly > 0); assert.equal(w.flightLandable, false); assert.ok(w.y >= 1.1);
  assert.deepEqual(sources, ['tide']); close(waders);
});

test('an egret abandons a destination that floods after takeoff', () => {
  const waders = new Waders(terrain, 1, 0, 0), w = waders.list[0]; place(w);
  waders.flush(w, 0, 0, 8); assert.equal(w.flightLandable, true);
  for (let i = 0; i < 120; i++) waders.update(1 / 60, i / 60, 0, 0, 0, 0);
  waders.update(1 / 60, 2, 0, 0, 0, 0.7);
  assert.equal(w.flightLandable, false); assert.ok(w.flightBlend > 0.99);
  for (let i = 0; i < 500; i++) waders.update(1 / 60, 2 + i / 60, w.x + 100, w.z, 0, 0.7);
  assert.ok(w.fly > 0 && w.y >= 1.2); close(waders);
});

test('an inland escape direction finds the nearby shoreline instead of extending into dry forest', () => {
  const waders = new Waders({ heightAt: x => Math.abs(x) < 1 ? -0.1 : 3 }, 1, 0, 0), w = waders.list[0];
  place(w, 0, 0); waders.rand = () => 0.25;
  waders.flush(w, -10, 0, 10);
  assert.equal(w.flightLandable, true); assert.ok(Math.abs(w.flightEndX) < 1);
  assert.ok(Math.hypot(w.flightEndX - w.x, w.flightEndZ - w.z) >= 16);
  close(waders);
});

test('failed local searches can return to a still-valid remembered feeding shelf', () => {
  const waders = new Waders({ heightAt: (x, z) => Math.abs(x) < 0.1 && Math.abs(z) < 0.1 ? -0.1 : 3 }, 1, 0, 0);
  const w = waders.list[0]; place(w, 40, 30); w.y = 4; w.shoreX = 0; w.shoreZ = 0; w.vx = 6; w.vz = 0;
  waders.planFlight(w, true);
  assert.equal(w.flightLandable, true); assert.equal(w.flightEndX, 0); assert.equal(w.flightEndZ, 0);
  close(waders);
});

test('stalking stays on shallow ground and the quick probe uses a separate pose', () => {
  const waders = new Waders({ heightAt: x => x > 0 ? 0.8 : -0.1 }, 1, 0, 0), w = waders.list[0];
  place(w, 0, 0); w.mesh.rotation.y = -Math.PI / 2; w.groundTime = 3;
  waders.update(1 / 60, 0, 100, 0, 0, 0);
  assert.equal(w.x, 0); assert.equal(w.walking, 0);
  w.groundTime = 14 * 0.70;
  waders.update(1 / 60, 0, 100, 0, 0, 0);
  assert.ok(w.probe > 0.99); assert.equal(w.walking, 0); assert.equal(w.fly, 0); close(waders);
});

test('the shipped egret is one textured mesh with six neutral-default morphs and bounded geometry', () => {
  const buffer = readFileSync(new URL('../public/wildlife/great-egret.glb', import.meta.url));
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
  assert.equal(json.meshes.length, 1); assert.equal(json.meshes[0].primitives.length, 1);
  const mesh = json.meshes[0], primitive = mesh.primitives[0], bounds = json.accessors[primitive.attributes.POSITION];
  assert.deepEqual(mesh.extras.targetNames, EGRET_POSES); assert.ok(mesh.weights.every(value => value === 0));
  assert.equal(primitive.targets.length, 6); assert.ok(primitive.targets.every(p => p.POSITION !== undefined && p.NORMAL !== undefined));
  assert.ok(primitive.attributes.COLOR_0 !== undefined && primitive.attributes.TEXCOORD_0 !== undefined);
  assert.equal(json.images.length, 1); assert.equal(json.images[0].mimeType, 'image/jpeg');
  assert.ok(json.materials[0].pbrMetallicRoughness.baseColorTexture);
  assert.ok(json.accessors[primitive.indices].count / 3 < 5000); assert.ok(buffer.length < 850000);
  assert.ok(bounds.max[1] > 1 && bounds.max[1] < 1.1); assert.ok(bounds.min[1] >= 0);
});

test('the exported flight retracts the neck, trails the feet and moves feather normals with the wings', async () => {
  const buffer = readFileSync(new URL('../public/wildlife/great-egret.glb', import.meta.url)), loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  const source = gltf.scene.children[0], geo = source.geometry, position = geo.attributes.position, targets = geo.morphAttributes.position;
  assert.ok(geo.morphTargetsRelative);
  let feet = 0, head = 0, wings = 0, normalChanges = 0, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    for (const attribute of [...targets, ...geo.morphAttributes.normal]) {
      assert.ok([attribute.getX(i), attribute.getY(i), attribute.getZ(i)].every(Number.isFinite));
    }
    const fx = x + targets[0].getX(i), fy = y + targets[0].getY(i), fz = z + targets[0].getZ(i);
    minX = Math.min(minX, fx); maxX = Math.max(maxX, fx);
    if (y < 0.045) { feet++; assert.ok(fz > 0.45 && fy > 0.35); }
    if (y > 0.98 && z < -0.3) { head++; assert.ok(fy < 0.8); }
    if (Math.abs(fx) > 0.6) {
      wings++;
      assert.ok(y + targets[1].getY(i) > fy + 0.3);
      assert.ok(y + targets[2].getY(i) < fy - 0.15);
      if (Math.abs(geo.morphAttributes.normal[0].getY(i)) > 0.1) normalChanges++;
    }
  }
  assert.ok(feet > 50 && head > 10 && wings > 30 && normalChanges > 20);
  assert.ok(maxX - minX > 1.31 && maxX - minX < 1.46);
  source.material.map.dispose(); geo.dispose(); source.material.dispose();
});
