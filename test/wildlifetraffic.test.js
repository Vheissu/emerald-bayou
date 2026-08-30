import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANATEE_CLEARANCE_METERS, copyManateeAvoidance, createManateeAvoidance, evaluateManateeApproach,
  manateeProbeScore, manateeReactionReady, manateeSpeedScale,
} from '../src/wildlifetraffic.js';

const input = (overrides = {}) => ({
  boatX: 0, boatZ: 0, boatHeading: 0, boatSpeed: 8,
  animalX: 6, animalZ: -48, animalHeading: Math.PI / 2, animalSpeed: 0.8,
  visible: true, sightRange: 90, sidePreference: -1, ...overrides,
});

test('a visible manatee inside the projected hull line creates a bounded closest-approach response', () => {
  const out = createManateeAvoidance();
  assert.equal(evaluateManateeApproach(input(), out), out);
  assert.equal(out.active, true); assert.ok(out.urgency > 0.35 && out.urgency <= 1);
  assert.ok(out.closestApproach < MANATEE_CLEARANCE_METERS); assert.ok(out.timeToClosest > 3 && out.timeToClosest < 7);
  assert.equal(out.turn, 1); // animal is to starboard, so the positive probe turns to port
});

test('a safe crossing, invisible animal, stopped hull, or animal already astern creates no response', () => {
  assert.equal(evaluateManateeApproach(input({ animalX: 60, animalZ: -40 }), {}).active, false);
  assert.equal(evaluateManateeApproach(input({ visible: false }), {}).active, false);
  assert.equal(evaluateManateeApproach(input({ boatSpeed: 0.2 }), {}).active, false);
  assert.equal(evaluateManateeApproach(input({ animalX: 0, animalZ: 45 }), {}).active, false);
});

test('ordinary skippers have a reaction delay but an immediate close-clearance override', () => {
  const distant = evaluateManateeApproach(input(), {});
  assert.equal(manateeReactionReady(distant, 0.3, 0.9), false);
  assert.equal(manateeReactionReady(distant, 0.9, 0.9), true);
  const close = evaluateManateeApproach(input({ animalX: 2, animalZ: -18 }), {});
  assert.equal(manateeReactionReady(close, 0, 2), true);
});

test('powered traffic comes off plane while paddlers make a smaller speed adjustment', () => {
  assert.ok(manateeSpeedScale(1, 'john') <= 0.18);
  assert.ok(manateeSpeedScale(0.8, 'john') < manateeSpeedScale(0.8, 'canoe'));
  assert.equal(manateeSpeedScale(0), 1); assert.ok(manateeSpeedScale(99, 'cruiser') >= 0.24);
});

test('probe scoring prefers the side that opens the predicted fifty-foot clearance', () => {
  const state = evaluateManateeApproach(input(), {}), leftProbe = manateeProbeScore(state, -18, -40, 0.7, 1);
  const rightProbe = manateeProbeScore(state, 18, -40, -0.7, 1);
  assert.ok(leftProbe > rightProbe);
});

test('retained inactive plans preserve infinite distance sentinels', () => {
  const source = createManateeAvoidance(), out = {};
  assert.equal(copyManateeAvoidance(source, out), out);
  assert.equal(out.active, false); assert.equal(out.distance, Infinity);
  assert.equal(out.closestApproach, Infinity); assert.equal(out.timeToClosest, Infinity); assert.equal(out.targetDistance, Infinity);
});
