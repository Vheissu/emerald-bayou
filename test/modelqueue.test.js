import test from 'node:test';
import assert from 'node:assert/strict';
import { configureModelLoading, loadModel, modelFrameBackoffMs, modelLoadingStats, modelPressureStep, orderDeferredModelNames, prepareModelForSwap, reportModelFramePressure } from '../src/models.js';

test('orders small visible hull upgrades ahead of the heavyweight tree replacement', () => {
  const requested = ['tree_c', 'realistic_alligator', 'fish_a', 'boat_dreams', 'driver', 'beau_boat', 'turtle_boat', 'sandbox_boat'];
  assert.deepEqual(orderDeferredModelNames(requested), ['boat_dreams', 'driver', 'beau_boat', 'sandbox_boat', 'fish_a', 'turtle_boat', 'realistic_alligator', 'tree_c']);
});

test('backs deferred model work away from bad frames without starving the queue', () => {
  assert.equal(modelFrameBackoffMs(1 / 60), 0);
  assert.equal(modelFrameBackoffMs(1 / 30), 0);
  assert.equal(modelFrameBackoffMs(0.04), 450);
  assert.equal(modelFrameBackoffMs(0.08), 1200);
  assert.equal(modelFrameBackoffMs(0.16), 2200);
  assert.equal(modelFrameBackoffMs(0.25), 3200);
  assert.deepEqual(modelPressureStep(1000, 1800, 900, 8000), { waitMs: 250, forced: false });
  assert.deepEqual(modelPressureStep(9100, 10000, 1000, 8000), { waitMs: 0, forced: true });
  assert.deepEqual(modelPressureStep(10000, 10000, 1000, 8000), { waitMs: 0, forced: false });
});

test('prepares an authored model before its visible swap and contains compiler failure', async () => {
  const root = {}, calls = []; let clock = 10;
  const prepared = await prepareModelForSwap(async (value, name) => { calls.push([value, name]); }, root, 'beau_boat', () => (clock += 4));
  assert.deepEqual(calls, [[root, 'beau_boat']]);
  assert.deepEqual(prepared, { attempted: true, completed: true, failed: false, durationMs: 4 });
  const failed = await prepareModelForSwap(async () => { throw new Error('compile failed'); }, root, 'driver', () => 20);
  assert.deepEqual(failed, { attempted: true, completed: false, failed: true, durationMs: 0 });
  assert.deepEqual(await prepareModelForSwap(null, root, 'tree_c'), { attempted: false, completed: false, failed: false, durationMs: 0 });
});

test('deduplicates optional model requests without fetching before release', () => {
  configureModelLoading({ deferOptional: true, concurrency: 1 });
  const first = loadModel('queued-test-model');
  const second = loadModel('queued-test-model');
  assert.equal(first, second);
  assert.deepEqual(modelLoadingStats(), { cached: 1, ready: 0, queued: 1, skipped: 0, concurrency: 1, deferred: true, pressure: { paused: false, remainingMs: 0, maxWaitMs: 8000, forcedBatches: 0 }, preparation: { attempted: 0, completed: 0, failures: 0, totalMs: 0, maxMs: 0 } });
  assert.equal(reportModelFramePressure(0.12, true), 2200);
  const pressure = modelLoadingStats().pressure;
  assert.equal(pressure.paused, true); assert.ok(pressure.remainingMs > 2000 && pressure.remainingMs <= 2200);
});

test('skips disabled heavyweight models without queueing or fetching them', async () => {
  configureModelLoading({ deferOptional: true, concurrency: 1, disabled: ['disabled-test-model'] });
  assert.equal(await loadModel('disabled-test-model'), null);
  const stats = modelLoadingStats();
  assert.equal(stats.cached, 2);
  assert.equal(stats.ready, 0);
  assert.equal(stats.queued, 1);
  assert.equal(stats.skipped, 1);
});
