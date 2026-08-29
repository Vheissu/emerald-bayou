import test from 'node:test';
import assert from 'node:assert/strict';
import { configureModelLoading, loadModel, modelLoadingStats, orderDeferredModelNames } from '../src/models.js';

test('orders small visible hull upgrades ahead of the heavyweight tree replacement', () => {
  const requested = ['tree_c', 'realistic_alligator', 'fish_a', 'boat_dreams', 'beau_boat', 'turtle_boat', 'sandbox_boat'];
  assert.deepEqual(orderDeferredModelNames(requested), ['boat_dreams', 'beau_boat', 'sandbox_boat', 'fish_a', 'turtle_boat', 'realistic_alligator', 'tree_c']);
});

test('deduplicates optional model requests without fetching before release', () => {
  configureModelLoading({ deferOptional: true, concurrency: 1 });
  const first = loadModel('queued-test-model');
  const second = loadModel('queued-test-model');
  assert.equal(first, second);
  assert.deepEqual(modelLoadingStats(), { cached: 1, ready: 0, queued: 1, concurrency: 1, deferred: true });
});
