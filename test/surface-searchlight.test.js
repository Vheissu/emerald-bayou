import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSurfaceSearchBeam, surfaceSearchlightResourceStats } from '../src/surface-searchlight.js';

test('surface searchlight beams share one tiny textureless geometry and cache materials by color', () => {
  const patrol = makeSurfaceSearchBeam(0xd9efff, 'patrol one');
  const backup = makeSurfaceSearchBeam(0xd9efff, 'patrol two');
  const courier = makeSurfaceSearchBeam(0xffe1b5, 'courier');
  assert.equal(patrol.geometry, backup.geometry); assert.equal(patrol.geometry, courier.geometry);
  assert.equal(patrol.material, backup.material); assert.notEqual(patrol.material, courier.material);
  assert.equal(patrol.visible, false); assert.equal(patrol.renderOrder, 34); assert.equal(Boolean(patrol.material.map), false);
  const stats = surfaceSearchlightResourceStats();
  assert.equal(stats.geometries, 1); assert.ok(stats.materials >= 2); assert.equal(stats.textures, 0);
  assert.ok(stats.geometryBytes > 0 && stats.geometryBytes < 1024);
});
