import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextQualityPreference,
  parseQualityPreference,
  qualityControllerConfig,
  qualityPreferenceLabel,
  readQualityPreference,
  writeQualityPreference,
} from '../src/displaysettings.js';

test('normalizes and cycles saved graphics preferences', () => {
  assert.equal(parseQualityPreference('balanced'), 'balanced');
  assert.equal(parseQualityPreference('ultra'), 'auto');
  assert.equal(nextQualityPreference('auto'), 'fallback');
  assert.equal(nextQualityPreference('cinematic'), 'auto');
});

test('maps auto to the hardware range and manual choices to a fixed level', () => {
  assert.deepEqual(qualityControllerConfig('auto', 2), { initialLevel: 2, minLevel: 0, maxLevel: 3 });
  assert.deepEqual(qualityControllerConfig('cinematic', 0), { initialLevel: 3, minLevel: 3, maxLevel: 3 });
  assert.deepEqual(qualityControllerConfig('performance', 3), { initialLevel: 1, minLevel: 1, maxLevel: 1 });
  assert.equal(qualityPreferenceLabel('auto', 'balanced'), 'Auto · Balanced');
  assert.equal(qualityPreferenceLabel('fallback', 'cinematic'), 'Fallback');
});

test('reads and writes preferences without requiring browser storage', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(readQualityPreference(storage), 'auto');
  assert.equal(writeQualityPreference('balanced', storage), 'balanced');
  assert.equal(readQualityPreference(storage), 'balanced');
  assert.equal(readQualityPreference({ getItem: () => { throw new Error('blocked'); } }), 'auto');
});
