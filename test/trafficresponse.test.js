import test from 'node:test';
import assert from 'node:assert/strict';
import { pursuitYieldSpeedScale, pursuitYieldStrength } from '../src/trafficresponse.js';

test('ambient boats only yield to a real nearby pursuit', () => {
  assert.equal(pursuitYieldStrength(false, 4, 30, 15), 0);
  assert.equal(pursuitYieldStrength(true, 4, Infinity, 15), 0);
  assert.equal(pursuitYieldStrength(true, 4, 190, 15), 0);
  assert.equal(pursuitYieldStrength(true, 4, 30, 15, 'john', true), 0);
});

test('pursuit response grows with proximity, speed, and wanted heat', () => {
  const far = pursuitYieldStrength(true, 1, 150, 5);
  const near = pursuitYieldStrength(true, 1, 45, 5);
  const urgent = pursuitYieldStrength(true, 5, 45, 16);
  assert.ok(near > far);
  assert.ok(urgent > near);
  assert.ok(urgent <= 1);
});

test('vulnerable paddle craft see farther and yield more speed', () => {
  assert.ok(pursuitYieldStrength(true, 3, 190, 12, 'canoe') > 0);
  assert.ok(pursuitYieldSpeedScale(0.8, 'canoe') < pursuitYieldSpeedScale(0.8, 'john'));
  assert.equal(pursuitYieldSpeedScale(0), 1);
  assert.ok(pursuitYieldSpeedScale(99, 'canoe') >= 0.14);
});
