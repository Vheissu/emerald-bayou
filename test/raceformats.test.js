import test from 'node:test';
import assert from 'node:assert/strict';
import { cargoEjectionReason, raceCourseDistances, raceCourseProgress, racePositionLabel, rampPoint, splitRemaining } from '../src/raceformats.js';

test('places ramp approach and landing points on opposite sides of the crest', () => {
  const bar = { x: 10, z: -20, dx: 0.6, dz: 0.8 };
  assert.deepEqual(rampPoint(bar, -40), { x: -14, z: -52 });
  assert.deepEqual(rampPoint(bar, 25), { x: 25, z: 0 });
});

test('split clocks never display a negative remainder', () => {
  assert.equal(splitRemaining(12, 5, 10), 3);
  assert.equal(splitRemaining(18, 5, 10), 0);
});

test('compares two hulls along a multi-leg race without per-frame course allocation', () => {
  const start = { x: 0, z: 0 }, gates = [{ x: 10, z: 0 }, { x: 10, z: 10 }];
  const distances = raceCourseDistances(start, gates);
  assert.ok(distances instanceof Float32Array);
  assert.deepEqual([...distances], [10, 20]);
  assert.equal(raceCourseProgress(start, gates, distances, 0, 4, 0), 4);
  assert.equal(raceCourseProgress(start, gates, distances, 1, 10, 6), 16);
  assert.equal(raceCourseProgress(start, gates, distances, 2, 50, 50), 20);
  assert.equal(racePositionLabel(30, 28), 'Side by side with Mud Hen');
  assert.equal(racePositionLabel(44, 28), '16 m ahead of Mud Hen');
  assert.equal(racePositionLabel(28, 44), '16 m behind Mud Hen');
});

test('relay cargo only ejects after a consequential jump, slam, roll, or collision', () => {
  assert.equal(cargoEjectionReason({ landedFrame: false, airTime: 0, impact: 2, roll: 0.2, hit: 2 }), '');
  assert.match(cargoEjectionReason({ landedFrame: true, airTime: 0.8, impact: 2, roll: 0.2, hit: 2 }), /landing/);
  assert.match(cargoEjectionReason({ landedFrame: false, airTime: 0, impact: 7, roll: 0.2, hit: 2 }), /slam/);
  assert.match(cargoEjectionReason({ landedFrame: false, airTime: 0, impact: 2, roll: 0.8, hit: 2 }), /rolled/);
  assert.match(cargoEjectionReason({ landedFrame: false, airTime: 0, impact: 2, roll: 0.2, hit: 6 }), /collision/);
});
