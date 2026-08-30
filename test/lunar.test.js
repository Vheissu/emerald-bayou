import test from 'node:test';
import assert from 'node:assert/strict';
import { lunarIllumination, lunarNightLight, lunarTideRange } from '../src/lunar.js';

test('lunar illumination and spring-neap range share one phase', () => {
  assert.equal(lunarIllumination(0), 0);
  assert.equal(lunarIllumination(Math.PI), 1);
  assert.equal(lunarTideRange(0), 1);
  assert.equal(lunarTideRange(Math.PI), 1);
  assert.equal(lunarTideRange(Math.PI / 2), 0.72);
});

test('night brightness requires an illuminated moon above a transmissive sky', () => {
  const full = lunarNightLight({ night: 1, altitude: 0.8, illumination: 1, transmission: 1 });
  const quarter = lunarNightLight({ night: 1, altitude: 0.8, illumination: 0.5, transmission: 1 });
  assert.equal(full, 1);
  assert.equal(lunarNightLight(1, 0.8, 1, 1), full);
  assert.ok(quarter > 0.55 && quarter < full);
  assert.equal(lunarNightLight({ night: 1, altitude: -0.1, illumination: 1, transmission: 1 }), 0);
  assert.equal(lunarNightLight({ night: 1, altitude: 0.8, illumination: 0, transmission: 1 }), 0);
  assert.equal(lunarNightLight({ night: 0, altitude: 0.8, illumination: 1, transmission: 1 }), 0);
  assert.equal(lunarNightLight({ night: 1, altitude: 0.8, illumination: 1, transmission: 0.25 }), 0.25);
});
