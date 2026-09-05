import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneLightPool, SCENE_POINT_LIGHTS, SCENE_SPOT_LIGHTS } from '../src/scenelightpool.js';

const visibleCounts = (scene, camera) => {
  const result = { point: 0, spot: 0, directional: 0 };
  scene.traverseVisible(light => {
    if (!light.layers.test(camera.layers)) return;
    if (light.isPointLight) result.point++;
    if (light.isSpotLight) result.spot++;
    if (light.isDirectionalLight) result.directional++;
  });
  return result;
};

test('rendered light counts stay fixed when mission rigs, strobes and camp lamps appear or disappear', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), rig = new THREE.Group();
  scene.add(new THREE.DirectionalLight(), rig);
  const lamp = new THREE.PointLight(0xff9933, 90, 30), strobe = new THREE.PointLight(0x3366ff, 150, 18);
  const search = new THREE.SpotLight(0xffffff, 700, 100); rig.add(lamp, strobe, search, search.target);
  const pool = new SceneLightPool(scene, { points: 3, spots: 2 }), expected = { point: 3, spot: 2, directional: 1 };
  for (let i = 0; i < 40; i++) {
    rig.visible = i % 2 === 0; strobe.intensity = i % 3 ? 150 : 0;
    const stats = pool.sync(camera);
    assert.deepEqual(visibleCounts(scene, camera), expected);
    assert.equal(stats.activeSpots, rig.visible ? 1 : 0);
    assert.equal(stats.activePoints, rig.visible ? (strobe.intensity ? 2 : 1) : 0);
  }
  pool.dispose(); assert.equal(lamp.layers.mask, 1); assert.equal(search.layers.mask, 1);
});

test('light selection favors nearby visible sources and frees slots without changing gameplay lights', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const near = new THREE.PointLight(0xffffff, 90, 30), far = new THREE.PointLight(0xffffff, 90, 30);
  near.position.set(0, 1, -5); far.position.set(0, 1, -90); scene.add(near, far);
  const pool = new SceneLightPool(scene, { points: 1, spots: 0 });
  assert.equal(pool.sync(camera).omittedPoints, 1);
  assert.equal(pool.points[0].source.light, near);
  assert.equal(pool.points[0].light.intensity, 90); assert.equal(near.intensity, 90);
  near.visible = false; pool.sync(camera); assert.equal(pool.points[0].source.light, far);
  far.removeFromParent(); pool.sync(camera); assert.equal(pool.points[0].light.intensity, 0);
  assert.equal(far.intensity, 90);
  pool.dispose(); assert.equal(near.visible, false);
});

test('spot proxies retain world aim and photometry while their boat turns', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), boat = new THREE.Group();
  const lamp = new THREE.SpotLight(0xffd8a0, 720, 135, 0.13, 0.52, 1.65);
  boat.position.set(25, 1, -30); lamp.position.set(0.3, 1.4, -0.5); lamp.target.position.set(0, 0.1, -60);
  boat.add(lamp, lamp.target); scene.add(boat);
  const pool = new SceneLightPool(scene, { points: 0, spots: 1 }), proxy = pool.spots[0].light;
  const expectedPosition = new THREE.Vector3(), expectedTarget = new THREE.Vector3();
  for (const heading of [0, 1.4, -2]) {
    boat.rotation.set(0.1, heading, -0.08, 'YXZ'); pool.sync(camera);
    lamp.getWorldPosition(expectedPosition); lamp.target.getWorldPosition(expectedTarget);
    assert.ok(proxy.position.distanceTo(expectedPosition) < 1e-10);
    assert.ok(proxy.target.position.distanceTo(expectedTarget) < 1e-10);
    assert.equal(proxy.intensity, lamp.intensity); assert.ok(proxy.color.equals(lamp.color));
    assert.equal(proxy.angle, lamp.angle); assert.equal(proxy.penumbra, lamp.penumbra);
    assert.equal(proxy.distance, lamp.distance); assert.equal(proxy.decay, lamp.decay);
  }
  pool.dispose();
});

test('pool bounds, registration, camera layers and retained storage survive repeated updates', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), light = new THREE.PointLight(0xffffff, 60);
  light.layers.set(1); scene.add(light);
  const pool = new SceneLightPool(scene, { points: Infinity, spots: 900 }); pool.register(scene);
  assert.equal(pool.points.length, SCENE_POINT_LIGHTS); assert.equal(pool.spots.length, SCENE_SPOT_LIGHTS);
  assert.equal(pool.sources.length, 1); assert.equal(pool.sync(camera).activePoints, 0);
  camera.layers.enable(1);
  const stats = pool.stats, position = pool.sources[0].position, pointSlots = pool.points, sourceList = pool.sources;
  for (let i = 0; i < 100; i++) { light.position.x = Math.sin(i); assert.equal(pool.sync(camera), stats); }
  assert.equal(stats.activePoints, 1); assert.equal(pool.sources[0].position, position);
  assert.equal(pool.sources, sourceList); assert.equal(pool.points, pointSlots);
  pool.dispose(); assert.equal(light.layers.mask, 2); assert.equal(pool.group.parent, null);
});

test('streamed recovery lights join the same pool and release their records when the rig is removed', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), pool = new SceneLightPool(scene, { points: 2, spots: 1 });
  const counts = visibleCounts(scene, camera);
  for (let i = 0; i < 30; i++) {
    const rig = new THREE.Group(), light = new THREE.PointLight(0xff6a25, 60, 50); rig.add(light); scene.add(rig);
    assert.equal(pool.sources.length, 1); assert.equal(light.layers.mask, 0);
    pool.sync(camera); assert.equal(pool.stats.activePoints, 1); assert.deepEqual(visibleCounts(scene, camera), counts);
    rig.removeFromParent();
    assert.equal(pool.sources.length, 0); assert.equal(light.layers.mask, 1);
    assert.ok(pool.points.every(slot => slot.source === null && slot.light.intensity === 0));
  }
  pool.dispose();
  const after = new THREE.PointLight(); scene.add(after); assert.equal(after.layers.mask, 1);
});
