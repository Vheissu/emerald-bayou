import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE_CAMERA_SAMPLES, chaseCameraBoomLimit, chaseCameraBoomStep } from '../src/chasecamera.js';

const boom = (overrides = {}) => ({
  startX: 0, startY: 2.2, startZ: 0,
  endX: 0, endY: 4.2, endZ: 12,
  waterLevel: 0, clearance: 0.9, minFraction: 0.2,
  safetyMargin: 0.03, samples: CHASE_CAMERA_SAMPLES,
  ...overrides,
});

test('flat water leaves the full chase camera boom available', () => {
  assert.equal(chaseCameraBoomLimit(boom(), () => -2), 1);
});

test('a bank between the boat and ideal camera retracts before the obstruction', () => {
  const limit = chaseCameraBoomLimit(boom(), (x, z) => z >= 4.5 && z <= 7 ? 3.4 : -2);
  assert.ok(limit >= 0.2); assert.ok(limit < 0.4);
  const z = 12 * limit;
  assert.ok(z < 4.5, `resolved camera should remain before the bank, got z=${z}`);
});

test('endpoint terrain is included in the boom clearance test', () => {
  const limit = chaseCameraBoomLimit(boom(), (x, z) => z > 10 ? 5 : -2);
  assert.ok(limit < 0.9);
});

test('water level is a camera floor during storm surge', () => {
  assert.equal(chaseCameraBoomLimit(boom({ startY: 1.5, endY: 1.8, waterLevel: 1.2 }), () => -3), 0.2);
});

test('invalid terrain samples fall back to the water plane without poisoning the camera', () => {
  assert.equal(chaseCameraBoomLimit(boom(), () => Number.NaN), 1);
  assert.equal(chaseCameraBoomLimit(boom({ waterLevel: Number.NaN }), () => Number.NaN), 1);
  assert.equal(chaseCameraBoomLimit(boom({ endX: Number.NaN }), () => 10), 1);
});

test('boom response cuts inward immediately and recovers gradually', () => {
  assert.equal(chaseCameraBoomStep(1, 0.34, 1 / 60), 0.34);
  const firstRecovery = chaseCameraBoomStep(0.34, 1, 1 / 60);
  assert.ok(firstRecovery > 0.34); assert.ok(firstRecovery < 0.38);
  let recovered = 0.34;
  for (let frame = 0; frame < 120; frame++) recovered = chaseCameraBoomStep(recovered, 1, 1 / 60);
  assert.ok(recovered > 0.99); assert.ok(recovered <= 1);
});
