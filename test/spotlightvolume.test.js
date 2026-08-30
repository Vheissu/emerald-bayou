import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatSpotlightVolume, makeSpotlightVolumeGeometry, spotlightVolumeState } from '../src/environment.js';

test('spotlight atmosphere strengthens in wet air while useful range contracts', () => {
  const clearDay = spotlightVolumeState({}, true, 0, 0, 0, 0, 1);
  const clearNight = spotlightVolumeState({}, true, 1, 0, 0, 0, 1);
  const fogNight = spotlightVolumeState({}, true, 1, 1, 0, 0, 1);
  const stormNight = spotlightVolumeState({}, true, 1, 0.2, 1, 1, 1);

  assert.ok(clearNight.strength > clearDay.strength);
  assert.ok(fogNight.strength > clearNight.strength);
  assert.ok(stormNight.strength > clearNight.strength);
  assert.ok(fogNight.range < clearNight.range);
  assert.ok(stormNight.range < clearNight.range);
  assert.equal(spotlightVolumeState({}, false, 1, 1, 1, 1, 1).visible, false);
  assert.equal(spotlightVolumeState({}, true, 1, 1, 1, 1, 0).visible, false);
  assert.equal(spotlightVolumeState({}, true, 0, 0, 0, 0, 0.42).visible, false);
  assert.equal(spotlightVolumeState({}, true, 1, 0, 0, 0, 0.42).visible, true);
});

test('spotlight state reuses the caller object and clamps invalid weather inputs', () => {
  const retained = { marker: 7 };
  assert.equal(spotlightVolumeState(retained, true, 4, -3, 5, Infinity, 2), retained);
  assert.equal(retained.marker, 7);
  assert.ok(retained.strength >= 0 && retained.strength <= 1);
  assert.ok(retained.range >= 44 && retained.range <= 92);
});

test('three nested shells share one compact textureless geometry', () => {
  const geometry = makeSpotlightVolumeGeometry(24);
  assert.equal(geometry.index, null);
  assert.equal(geometry.attributes.position.count, 432);
  assert.equal(geometry.attributes.aAxial.count, 432);
  assert.equal(geometry.attributes.aShell.count, 432);
  assert.equal(geometry.userData.byteLength, 8640);
  assert.ok(geometry.boundingSphere?.radius > 0.5 && geometry.boundingSphere.radius < 1);
  geometry.dispose();
});

test('the live beam keeps one resource set and stops writes when hidden', () => {
  const volume = new BoatSpotlightVolume({ spotlightVolume: 1 });
  const geometry = volume.geometry, material = volume.material, state = volume.state;

  assert.equal(volume.mesh.layers.mask, 2);
  assert.equal(volume.update(12, true, 1, 0.8, 0.45, 0.2), state);
  assert.equal(volume.mesh.visible, true);
  assert.ok(volume.mesh.scale.x >= 44 && volume.mesh.scale.x <= 92);
  assert.equal(volume.resourceStats().drawCalls, 1);

  const transformWrites = volume.transformWrites, uniformWrites = volume.uniformWrites;
  volume.update(13, false, 1, 1, 1, 1);
  assert.equal(volume.mesh.visible, false);
  assert.equal(volume.transformWrites, transformWrites);
  assert.equal(volume.uniformWrites, uniformWrites);

  volume.setQuality({ spotlightVolume: 0 });
  volume.update(14, true, 1, 1, 1, 1);
  assert.equal(volume.resourceStats().drawCalls, 0);
  volume.setQuality({ spotlightVolume: 0.42 });
  volume.update(15, true, 1, 0, 0, 0);
  assert.equal(volume.resourceStats().drawCalls, 1);
  assert.equal(volume.geometry, geometry);
  assert.equal(volume.material, material);
  assert.deepEqual(
    { geometries: volume.resourceStats().geometries, materials: volume.resourceStats().materials, textures: volume.resourceStats().textures, lights: volume.resourceStats().lights, vertices: volume.resourceStats().vertices, geometryBytes: volume.resourceStats().geometryBytes },
    { geometries: 1, materials: 1, textures: 0, lights: 0, vertices: 432, geometryBytes: 8640 },
  );
  volume.dispose();
});
