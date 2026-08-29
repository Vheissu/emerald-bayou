import test from 'node:test';
import assert from 'node:assert/strict';
import { startupPlan, startupTerrainReady } from '../src/startup.js';
import { Terrain } from '../src/terrain.js';

test('cinematic hardware keeps the complete shader and model warm-up', () => {
  const plan = startupPlan('cinematic');
  assert.equal(plan.warmShaders, true);
  assert.deepEqual(plan.blockingModels, ['beau_boat', 'boat_dreams', 'sandbox_boat', 'realistic_alligator', 'turtle_boat', 'fish_a']);
  assert.equal(plan.terrainReadiness, 'settled');
  assert.equal(plan.maxWaitMs, 20000);
  assert.equal(plan.compileDelayMs, 250);
});

test('older-hardware profiles do not block on optional models or the full shader warm-up', () => {
  for (const id of ['fallback', 'performance', 'balanced']) {
    const plan = startupPlan(id);
    assert.equal(plan.warmShaders, false);
    assert.deepEqual(plan.blockingModels, []);
    assert.equal(plan.terrainReadiness, 'local');
    assert.ok(plan.maxWaitMs >= 3000 && plan.maxWaitMs <= 6000);
    assert.equal(plan.compileDelayMs, 0);
  }
});

test('startup readiness distinguishes a usable local tile from a completely settled stream', () => {
  const state = { settled: false, localVisible: true };
  assert.equal(startupTerrainReady('local', state), true);
  assert.equal(startupTerrainReady('settled', state), false);
  assert.equal(startupPlan('unknown').id, 'performance');
});

test('local startup only opens on terrain that is actually visible under the dock', () => {
  const terrain = { visible: new Set([
    { x0: -100, z0: -100, size: 100, mesh: { visible: true } },
    { x0: 0, z0: 0, size: 100, mesh: { visible: false } },
  ]) };
  assert.equal(Terrain.prototype.visibleAt.call(terrain, -20, -20), true);
  assert.equal(Terrain.prototype.visibleAt.call(terrain, 20, 20), false);
  assert.equal(Terrain.prototype.visibleAt.call(terrain, 140, 140), false);
});
