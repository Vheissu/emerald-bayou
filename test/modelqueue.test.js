import test from 'node:test';
import assert from 'node:assert/strict';
import { configureModelLoading, loadModel, modelLoadingStats } from '../src/models.js';

test('deduplicates optional model requests without fetching before release', () => {
  configureModelLoading({ deferOptional: true, concurrency: 1 });
  const first = loadModel('queued-test-model');
  const second = loadModel('queued-test-model');
  assert.equal(first, second);
  assert.deepEqual(modelLoadingStats(), { cached: 1, ready: 0, queued: 1, concurrency: 1, deferred: true });
});
