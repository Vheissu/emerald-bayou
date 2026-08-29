import test from 'node:test';
import assert from 'node:assert/strict';
import { hornYieldSpeedScale, hornYieldStrength, pursuitYieldSpeedScale, pursuitYieldStrength } from '../src/trafficresponse.js';

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

test('a horn only triggers an avoidance response ahead and inside audible range', () => {
  assert.equal(hornYieldStrength(Infinity, 1, 12), 0);
  assert.equal(hornYieldStrength(40, -0.2, 12), 0);
  assert.equal(hornYieldStrength(180, 1, 12), 0);
  assert.ok(hornYieldStrength(55, 1, 12) > 0);
});

test('horn response grows for a closing vessel and a prolonged signal carries farther', () => {
  const slow = hornYieldStrength(70, 0.9, 2);
  const closing = hornYieldStrength(70, 0.9, 14);
  assert.ok(closing > slow);
  assert.equal(hornYieldStrength(220, 1, 10), 0);
  assert.ok(hornYieldStrength(220, 1, 10, 'john', true) > 0);
});

test('paddle craft shed more speed after a close sound signal', () => {
  assert.ok(hornYieldSpeedScale(0.8, 'canoe') < hornYieldSpeedScale(0.8, 'john'));
  assert.equal(hornYieldSpeedScale(0), 1);
  assert.ok(hornYieldSpeedScale(99, 'canoe') >= 0.28);
});
