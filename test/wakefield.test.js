import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COMBINED_WAKE_HEIGHT, MAX_DIRECTED_WAKE_HEIGHT, clampWakeHeight, sampleTrafficWake, sampleVesselWake,
  sampleWakeFields, trafficWakeScale, wakeSampleAt,
} from '../src/wakefield.js';

const leader = (overrides = {}) => ({
  active: true, kind: 'john', x: 0, z: 0, heading: 0, speed: 10, max: 12, ...overrides,
});

test('a moving hull leaves two decaying wake arms only behind its stern', () => {
  assert.equal(wakeSampleAt(0, 0, 0, 2.2, 12, 0.2, 14.7, 40, 0), 0);
  assert.equal(wakeSampleAt(0, 0, 0, 10, 12, 0.2, 14.7, -20, 0), 0);
  assert.equal(wakeSampleAt(0, 0, 0, 10, 12, 0.2, 14.7, 100, 0), 0);

  const arm = wakeSampleAt(0, 0, 0, 10, 12, 0.2, 14.7, 40, 0);
  const center = wakeSampleAt(0, 0, 0, 10, 12, 0.2, 0, 40, 0);
  assert.ok(Math.abs(arm) > Math.abs(center) * 2.5);
});

test('traffic wake sampling ignores the receiving hull and non-motorized or inactive craft', () => {
  const source = leader(), receiver = leader({ x: 14.7, z: 40, speed: 0 });
  const expected = wakeSampleAt(source.x, source.z, source.heading, source.speed, source.max, trafficWakeScale(source.kind), receiver.x, receiver.z, 0);
  assert.ok(Math.abs(expected) > 0.02);
  assert.ok(Math.abs(sampleTrafficWake([source, receiver], receiver.x, receiver.z, 0, receiver) - expected) < 1e-12);
  assert.equal(sampleTrafficWake([source], receiver.x, receiver.z, 0, source), 0);
  assert.equal(sampleTrafficWake([leader({ active: false }), leader({ kind: 'canoe' })], receiver.x, receiver.z, 0), 0);
});

test('overlapping resident wakes stay inside the bounded physical surface range', () => {
  const traffic = Array.from({ length: 10 }, () => leader());
  assert.equal(sampleTrafficWake(traffic, 14.7, 40, 0), -0.24);
  assert.ok(trafficWakeScale('air') > trafficWakeScale('cruiser'));
  assert.ok(trafficWakeScale('cruiser') > trafficWakeScale('john'));
});

test('retained mission-vessel records produce physical wakes without being mutated', () => {
  const source = Object.freeze({ active: true, x: 0, z: 0, heading: 0, speed: 10, wakeMaxSpeed: 12, wakeScale: 0.14 });
  const sources = Object.freeze([source]);
  const expected = wakeSampleAt(source.x, source.z, source.heading, source.speed, source.wakeMaxSpeed, source.wakeScale, 14.7, 40, 0);
  assert.ok(Math.abs(expected) > 0.02);
  assert.equal(sampleVesselWake(sources, 14.7, 40, 0), expected);
});

test('directed wake sampling skips backed, inactive, malformed, and distant craft', () => {
  const probe = (overrides = {}) => ({ active: true, x: 0, z: 0, heading: 0, speed: 10, ...overrides });
  assert.equal(sampleVesselWake([probe({ active: false }), probe({ backing: true }), probe({ x: NaN })], 14.7, 40, 0), 0);
  assert.equal(sampleVesselWake([probe()], 600, 600, 0), 0);
  assert.equal(sampleVesselWake(Array.from({ length: 12 }, () => probe({ wakeScale: 0.2 })), 14.7, 40, 0), -MAX_DIRECTED_WAKE_HEIGHT);
});

test('the combined player wake field is bounded across overlapping systems', () => {
  const fields = Object.freeze([
    Object.freeze({ wakeHeightAt: () => 0.22 }),
    Object.freeze({ wakeHeightAt: () => 0.19 }),
    Object.freeze({ wakeHeightAt: () => -0.03 }),
    null,
  ]);
  assert.equal(sampleWakeFields(fields, 0, 0, 0), MAX_COMBINED_WAKE_HEIGHT);
  assert.equal(sampleWakeFields([{ wakeHeightAt: () => -0.8 }], 0, 0, 0), -MAX_COMBINED_WAKE_HEIGHT);
  assert.equal(clampWakeHeight(Number.NaN, 0.2), 0);
});
