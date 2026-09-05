import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { constrainedAssetTransfer, OPTIONAL_MODEL_NAMES, startupPlan, startupTerrainFocus, startupTerrainReady } from '../src/startup.js';
import { compareTerrainBuildPriority, normalizeTerrainStreamOptions, shouldPreemptTerrainBuild, Terrain } from '../src/terrain.js';

test('cinematic hardware warms shaders without blocking the title on authored models', () => {
  const plan = startupPlan('cinematic');
  assert.equal(plan.warmShaders, true);
  assert.deepEqual(plan.blockingModels, []);
  assert.equal(plan.terrainReadiness, 'local');
  assert.equal(plan.maxWaitMs, 6000);
  assert.equal(plan.compileDelayMs, 0);
  assert.equal(plan.deferOptionalModels, true);
  assert.equal(plan.releaseModelsAtTitle, true);
  assert.equal(plan.titleModelReleaseDelayMs, 1200);
  assert.equal(plan.modelConcurrency, 1);
  assert.equal(plan.modelBatchDelayMs, 420);
  assert.equal(plan.modelPressureMaxWaitMs, 6000);
  assert.equal(plan.solidGrass, 'deferred');
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
    assert.equal(plan.releaseModelsAtTitle, false);
    assert.ok(plan.modelConcurrency >= 1 && plan.modelConcurrency <= 2);
    assert.ok(plan.modelReleaseDelayMs >= 700);
    assert.ok(plan.modelBatchDelayMs >= 0);
    assert.ok(plan.modelIdleTimeoutMs >= 900);
    assert.ok(plan.modelPressureMaxWaitMs >= 4000);
  }
  const fallback = startupPlan('fallback'), performance = startupPlan('performance'), balanced = startupPlan('balanced');
  assert.ok(fallback.modelReleaseDelayMs > performance.modelReleaseDelayMs);
  assert.ok(performance.modelReleaseDelayMs > balanced.modelReleaseDelayMs);
  assert.ok(fallback.modelBatchDelayMs > performance.modelBatchDelayMs);
  assert.ok(performance.modelBatchDelayMs > balanced.modelBatchDelayMs);
  assert.deepEqual(fallback.disabledModels, OPTIONAL_MODEL_NAMES);
  assert.deepEqual(performance.disabledModels, fallback.disabledModels);
  assert.deepEqual(balanced.disabledModels, ['tree_c']);
  assert.equal(balanced.modelConcurrency, 1);
  assert.equal(fallback.disabledModels.length, 10);
  assert.deepEqual([fallback.solidGrass, performance.solidGrass, balanced.solidGrass], ['off', 'off', 'deferred']);
  assert.deepEqual([fallback.modelPressureMaxWaitMs, performance.modelPressureMaxWaitMs, balanced.modelPressureMaxWaitMs], [12000, 8000, 6000]);
  assert.deepEqual(['fallback', 'performance', 'balanced', 'cinematic'].map(id => startupPlan(id).blockingModels), [[], [], [], []]);
});

test('constrained transfers keep the full world budget while skipping optional model traffic', () => {
  assert.equal(constrainedAssetTransfer(), false);
  assert.equal(constrainedAssetTransfer({ saveData: true, effectiveType: '4g', downlink: 50 }), true);
  assert.equal(constrainedAssetTransfer({ effectiveType: '3g', downlink: 10 }), true);
  assert.equal(constrainedAssetTransfer({ effectiveType: '4g', downlink: 2.5 }), true);
  assert.equal(constrainedAssetTransfer({ effectiveType: '4g', downlink: 2.6 }), false);

  for (const id of ['balanced', 'cinematic']) {
    const regular = startupPlan(id), constrained = startupPlan(id, { constrainedTransfer: true });
    assert.equal(constrained.constrainedTransfer, true); assert.equal(Object.isFrozen(constrained), true);
    assert.deepEqual(constrained.disabledModels, OPTIONAL_MODEL_NAMES); assert.equal(constrained.solidGrass, 'off');
    assert.equal(constrained.releaseModelsAtTitle, false); assert.equal(constrained.modelConcurrency, 1);
    assert.equal(constrained.effectBudget, regular.effectBudget); assert.equal(constrained.streamBudget, regular.streamBudget);
    assert.equal(constrained.warmShaders, regular.warmShaders); assert.equal(constrained.terrainReadiness, regular.terrainReadiness);
  }
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

test('streaming budgets preserve the map while shedding low-end foliage work', () => {
  const fallback = startupPlan('fallback').streamBudget;
  const performance = startupPlan('performance').streamBudget;
  const balanced = startupPlan('balanced').streamBudget;
  const cinematic = startupPlan('cinematic').streamBudget;

  assert.deepEqual([fallback.foliageDetail, performance.foliageDetail, balanced.foliageDetail, cinematic.foliageDetail], [0.36, 0.56, 0.82, 1]);
  assert.ok(fallback.terrainPrefetch < performance.terrainPrefetch);
  assert.ok(performance.terrainPrefetch < balanced.terrainPrefetch);
  assert.ok(balanced.terrainPrefetch < cinematic.terrainPrefetch);
  assert.deepEqual([fallback.terrainWorkerLimit, performance.terrainWorkerLimit, balanced.terrainWorkerLimit, cinematic.terrainWorkerLimit], [1, 1, 2, 4]);
  assert.deepEqual([fallback.terrainFinalizeBudgetMs, performance.terrainFinalizeBudgetMs, balanced.terrainFinalizeBudgetMs, cinematic.terrainFinalizeBudgetMs], [1.25, 2, 3, 4]);
  for (const plan of [fallback, performance, balanced, cinematic]) assert.ok(Object.isFrozen(plan));
});

test('terrain stream options are bounded without changing world extent', () => {
  assert.deepEqual(normalizeTerrainStreamOptions(), { prefetch: 1.35, finalizeBudgetMs: 4, workerLimit: 4 });
  assert.deepEqual(normalizeTerrainStreamOptions({ prefetch: 0, finalizeBudgetMs: 99, workerLimit: 12 }), { prefetch: 1.05, finalizeBudgetMs: 6, workerLimit: 4 });
  assert.deepEqual(normalizeTerrainStreamOptions({ prefetch: 1.2, finalizeBudgetMs: 2, workerLimit: 1 }), { prefetch: 1.2, finalizeBudgetMs: 2, workerLimit: 1 });
});

test('startup readiness distinguishes a usable local tile from a completely settled stream', () => {
  const state = { settled: false, localVisible: true };
  assert.equal(startupTerrainReady('local', state), true);
  assert.equal(startupTerrainReady('settled', state), false);
  assert.equal(startupPlan('unknown').id, 'performance');
});

test('startup terrain follows a restored boat but leaves new games focused on the dock', () => {
  assert.deepEqual(startupTerrainFocus({ dockX: 12, dockZ: 70, boatX: -900, boatZ: 1200, positionRestored: true }), {
    x: -900, z: 1200, restored: true, retargeted: true,
  });
  assert.deepEqual(startupTerrainFocus({ dockX: 12, dockZ: 70, boatX: -900, boatZ: 1200, positionRestored: false }), {
    x: 12, z: 70, restored: false, retargeted: false,
  });
  assert.deepEqual(startupTerrainFocus({ dockX: 12, dockZ: 70, boatX: Number.NaN, boatZ: 1200, positionRestored: true }), {
    x: 12, z: 70, restored: false, retargeted: false,
  });
});

test('moving the stream focus reprioritizes stale dock work behind the current boat tile', () => {
  const staleDock = { x0: 0, z0: 0, size: 100, level: 0, prio: 0, prioBias: 0 };
  const currentBoat = { x0: 900, z0: 0, size: 100, level: 0, prio: 9, prioBias: 0 };
  const prefetched = { x0: 900, z0: 100, size: 100, level: 0, prio: 2, prioBias: 2 };
  const returnedBoat = { x0: 900, z0: 0, size: 100, level: 1, prio: 9, prioBias: 0 };
  const terrain = Object.assign(Object.create(Terrain.prototype), {
    camPos: new THREE.Vector2(950, 50), queue: [staleDock, prefetched, currentBoat], finalize: [returnedBoat], building: null, pausedBuilding: null,
  });

  terrain.reprioritizePending();

  assert.equal(terrain.queue[0], currentBoat);
  assert.equal(terrain.queue[1], prefetched);
  assert.equal(terrain.queue[2], staleDock);
  assert.equal(returnedBoat.prio, 0);
});

test('terrain workers are primed before the synchronous environment convolution', () => {
  const terrain = {
    camPos: new THREE.Vector2(), streamT: 0, queue: [1, 2], pool: { inFlight: 0 },
    stream(now) { this.streamedAt = now; }, pump() { this.pool.inFlight = 2; },
  };
  const result = Terrain.prototype.prime.call(terrain, 14, -9, 500);
  assert.deepEqual([terrain.camPos.x, terrain.camPos.y, terrain.streamT, terrain.streamedAt], [14, -9, 500, 500]);
  assert.deepEqual(result, { queued: 2, inFlight: 2 });

  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const managerSource = readFileSync(new URL('../src/environmentmap.js', import.meta.url), 'utf8');
  const primeAt = source.indexOf('terrain.prime(startX, startZ)');
  const captureAt = source.indexOf("environmentReflections.capture(initialReflectionState, 'initial'");
  assert.ok(primeAt >= 0 && captureAt >= 0 && primeAt < captureAt);
  assert.ok(managerSource.includes('generator.fromScene('));
});

test('cinematic model upgrades start behind the title without retaining the disposed warm-up tree', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.ok(source.includes('constrainedAssetTransfer(navigator.connection)'));
  assert.ok(source.includes('if (startup.releaseModelsAtTitle) scheduleDeferredModels(startup.titleModelReleaseDelayMs)'));
  assert.ok(source.includes('scheduleDeferredModels(startup.modelReleaseDelayMs, true)'));
  assert.ok(source.includes('if (!startup.deferOptionalModels) for (const [k, name]'));
});

test('local startup only opens on terrain that is actually visible under its focus', () => {
  const terrain = { visible: new Set([
    { x0: -100, z0: -100, size: 100, mesh: { visible: true } },
    { x0: 0, z0: 0, size: 100, mesh: { visible: false } },
  ]) };
  assert.equal(Terrain.prototype.visibleAt.call(terrain, -20, -20), true);
  assert.equal(Terrain.prototype.visibleAt.call(terrain, 20, 20), false);
  assert.equal(Terrain.prototype.visibleAt.call(terrain, 140, 140), false);
});

test('terrain finalization favors proximity and then the finest equal-distance ground', () => {
  assert.ok(compareTerrainBuildPriority({ prio: 0.1, level: 4 }, { prio: 0.2, level: 0 }) < 0);
  assert.ok(compareTerrainBuildPriority({ prio: 0, level: 0 }, { prio: 0, level: 4 }) < 0);
  assert.equal(compareTerrainBuildPriority({ prio: 0.1, level: 2 }, { prio: 0.1, level: 2 }), 0);
});

test('near-field terrain can pause only one coarse vegetation build', () => {
  const coarse = { prio: 0, level: 4 }, near = { prio: 0, level: 0 };
  assert.equal(shouldPreemptTerrainBuild(coarse, near), true);
  assert.equal(shouldPreemptTerrainBuild(coarse, { prio: 0, level: 2 }), false);
  assert.equal(shouldPreemptTerrainBuild(coarse, near, { prio: 0, level: 3 }), false);
});

test('a finished ground mesh is selectable while its vegetation is still building', () => {
  const chunk = { groundReady: true, ready: false };
  const visible = new Set();
  Terrain.prototype.select.call({}, { leaf: true, c: chunk }, 0, visible);
  assert.equal(visible.has(chunk), true);
});

test('a dock-scale result interrupts coarse foliage without retaining another build', t => {
  // Test priority and resumption, not whether the host happens to finish inside a wall-clock frame budget.
  let now = 0; t.mock.method(performance, 'now', () => (now += 0.05));
  const endless = function* () { while (true) yield; };
  const quick = function* () { yield; };
  const coarse = { key: '4:0:0', prio: 0, level: 4, groundReady: true, ready: false, mesh: {}, build: endless() };
  const local = { key: '0:0:0', prio: 0, level: 0, groundReady: false, ready: false, mesh: null, build: null, veg: null };
  const material = new THREE.MeshBasicMaterial();
  const terrain = Object.assign(Object.create(Terrain.prototype), {
    uniforms: null, camPos: new THREE.Vector2(), streamT: performance.now(), queue: [], finalize: [local], building: coarse, pausedBuilding: null,
    visible: new Set(), chunks: new Map(), group: new THREE.Group(), material, stats: {}, pool: { inFlight: 0 },
    pump() {}, makeGeometry() { return new THREE.BufferGeometry(); }, hooks: { ready: () => quick(), done: null },
  });

  terrain.update(0, { x: 0, z: 0 });

  assert.equal(local.groundReady, true);
  assert.equal(local.ready, true);
  assert.equal(coarse.ready, false);
  assert.equal(terrain.building, coarse);
  assert.equal(terrain.pausedBuilding, null);
  local.mesh.geometry.dispose(); material.dispose();
});

test('disposing a paused terrain chunk releases its retained vegetation generator', () => {
  const geometry = new THREE.BufferGeometry(), mesh = new THREE.Mesh(geometry);
  const chunk = { key: '4:0:0', mesh, veg: null, build: (function* () { yield; })(), groundReady: true, ready: false };
  const terrain = Object.assign(Object.create(Terrain.prototype), {
    chunks: new Map([[chunk.key, chunk]]), queue: [], finalize: [], pausedBuilding: chunk, group: new THREE.Group(), hooks: { dispose: null },
  });
  terrain.group.add(mesh);

  terrain.dispose(chunk);

  assert.equal(terrain.pausedBuilding, null);
  assert.equal(chunk.build, null);
  assert.equal(chunk.groundReady, false);
  assert.equal(chunk.disposed, true);
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
