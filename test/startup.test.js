import test from 'node:test';
import assert from 'node:assert/strict';
import { startupPlan, startupTerrainReady } from '../src/startup.js';
import { Terrain } from '../src/terrain.js';

test('cinematic hardware keeps the complete shader and model warm-up', () => {
  const plan = startupPlan('cinematic');
  assert.equal(plan.warmShaders, true);
  assert.deepEqual(plan.blockingModels, ['beau_boat', 'boat_dreams', 'sandbox_boat', 'realistic_alligator', 'turtle_boat', 'fish_a', 'driver']);
  assert.equal(plan.terrainReadiness, 'settled');
  assert.equal(plan.maxWaitMs, 20000);
  assert.equal(plan.compileDelayMs, 250);
  assert.equal(plan.deferOptionalModels, false);
  assert.equal(plan.modelConcurrency, 4);
  assert.equal(plan.solidGrass, 'blocking');
  assert.deepEqual(plan.disabledModels, []);
});

test('older-hardware profiles do not block on optional models or the full shader warm-up', () => {
  for (const id of ['fallback', 'performance', 'balanced']) {
    const plan = startupPlan(id);
    assert.equal(plan.warmShaders, false);
    assert.deepEqual(plan.blockingModels, []);
    assert.equal(plan.terrainReadiness, 'local');
    assert.ok(plan.maxWaitMs >= 3000 && plan.maxWaitMs <= 6000);
    assert.equal(plan.compileDelayMs, 0);
    assert.equal(plan.deferOptionalModels, true);
    assert.ok(plan.modelConcurrency >= 1 && plan.modelConcurrency <= 2);
    assert.ok(plan.modelReleaseDelayMs >= 700);
    assert.ok(plan.modelBatchDelayMs >= 0);
    assert.ok(plan.modelIdleTimeoutMs >= 900);
  }
  const fallback = startupPlan('fallback'), performance = startupPlan('performance'), balanced = startupPlan('balanced');
  assert.ok(fallback.modelReleaseDelayMs > performance.modelReleaseDelayMs);
  assert.ok(performance.modelReleaseDelayMs > balanced.modelReleaseDelayMs);
  assert.ok(fallback.modelBatchDelayMs > performance.modelBatchDelayMs);
  assert.ok(performance.modelBatchDelayMs > balanced.modelBatchDelayMs);
  assert.deepEqual(fallback.disabledModels, ['grass_a', 'grass_d', 'tree_c']);
  assert.deepEqual(performance.disabledModels, fallback.disabledModels);
  assert.deepEqual(balanced.disabledModels, []);
  assert.deepEqual([fallback.solidGrass, performance.solidGrass, balanced.solidGrass], ['off', 'off', 'deferred']);
});

test('older-hardware profiles allocate smaller bounded weather and spray pools', () => {
  const fallback = startupPlan('fallback').effectBudget;
  const performance = startupPlan('performance').effectBudget;
  const balanced = startupPlan('balanced').effectBudget;
  const cinematic = startupPlan('cinematic').effectBudget;
  for (const key of ['spray', 'plume', 'rain', 'hail']) {
    assert.ok(fallback[key] < performance[key]);
    assert.ok(performance[key] < balanced[key]);
    assert.equal(balanced[key], cinematic[key]);
  }
  assert.deepEqual(cinematic, { spray: 12000, plume: 2600, rain: 2200, hail: 720 });
  assert.ok(Object.isFrozen(fallback));
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

test('terrain streaming reuses its quadtree scratch graph and visibility sets', () => {
  const terrain = Object.assign(Object.create(Terrain.prototype), {
    camPos: { x: 0, y: 0 }, chunks: new Map(), queue: [], finalize: [], building: null,
    visible: new Set(), nextVisible: new Set(), streamNodes: [], streamNodeCount: 0,
    hooks: { dispose: null },
  });
  terrain.stream(1000);
  const nodes = terrain.streamNodes.slice(), visible = terrain.visible, spare = terrain.nextVisible;
  assert.equal(nodes.length, 304);
  terrain.stream(1200);
  assert.equal(terrain.streamNodes.length, nodes.length);
  assert.ok(terrain.streamNodes.every((node, index) => node === nodes[index]));
  assert.equal(terrain.visible, spare);
  assert.equal(terrain.nextVisible, visible);
});
