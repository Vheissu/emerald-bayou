import test from 'node:test';
import assert from 'node:assert/strict';
import { boatFloodRate, boatSinkOffset, bottomStrikeDamage, bottomStrikeSeverity } from '../src/boatdamage.js';

test('only a fast transition onto a submerged bed becomes a bottom strike', () => {
  assert.equal(bottomStrikeSeverity(4, 0, 0.8, 0.08, 0.5), 0);
  assert.equal(bottomStrikeSeverity(15, 0.7, 0.72, 0.08, 0.5), 0);
  assert.equal(bottomStrikeSeverity(15, 0, 0.72, -0.4, 0.5), 0);
  const hard = bottomStrikeSeverity(15, 0, 0.72, 0.08, 0.5);
  assert.ok(hard > 10);
  assert.ok(bottomStrikeSeverity(15, 0, 0.72, 0.08, 0.7) > bottomStrikeSeverity(10, 0, 0.35, 0.18, 0.08));
});

test('harder bottom strikes tear more hull and open a persistent breach', () => {
  const mild = bottomStrikeDamage(7, 0, {}), hard = bottomStrikeDamage(16, 0.1, {});
  assert.ok(mild.hull > 0 && mild.breachGain > 0);
  assert.ok(hard.hull > mild.hull * 3);
  assert.ok(hard.breach > 0.4 && hard.flood > 0.02);
  assert.equal(bottomStrikeDamage(3, 0.2, {}).breach, 0.2);
});

test('the bilge pump can hold a pinhole but a split hull founders faster as it settles', () => {
  assert.ok(boatFloodRate(92, 0.04, 0.1, 1, true) < 0);
  const early = boatFloodRate(62, 0.62, 0.1, 1, true), deep = boatFloodRate(62, 0.62, 0.85, 1, true);
  assert.ok(early > 0.006); assert.ok(deep > early * 1.5);
  assert.ok(boatFloodRate(62, 0.62, 0.4, 1, false) > boatFloodRate(62, 0.62, 0.4, 1, true));
  assert.equal(boatSinkOffset(0.5, 1), 0); assert.ok(boatSinkOffset(1, 0.8) > 0.3);
});
