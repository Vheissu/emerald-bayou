import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORE_FOAM, SHORE_FOAM_GLSL, shoreFoamDrive } from '../src/shorefoam.js';
import { readFileSync } from 'node:fs';

test('calm and foggy water cannot create a depth-only foam border', () => {
  for (const sea of [0, 0.04, 0.08, SHORE_FOAM.windStart]) {
    for (const crest of [0, 0.25, 0.5, 1]) assert.equal(shoreFoamDrive(sea, 0, 0, crest), 0);
  }
});

test('storm shore wash pulses with crests while preserving its original peak', () => {
  assert.equal(shoreFoamDrive(2.15, 0, 0, 0), 0);
  assert.equal(shoreFoamDrive(2.15, 0, 0, 1), 1);
  assert.ok(shoreFoamDrive(0.28, 0, 0) < shoreFoamDrive(0.78, 0, 0));
  assert.ok(shoreFoamDrive(0.78, 0, 0) < shoreFoamDrive(1.05, 0, 0));
  assert.ok(shoreFoamDrive(2.15, 0, 0, 1, 1) < shoreFoamDrive(2.15, 0, 0, 1, 0));
});

test('boat foam and pressure-wave slope can each disturb a calm sheltered bank', () => {
  assert.equal(shoreFoamDrive(0.08, SHORE_FOAM.washFull, 0, 0, 1), 1);
  assert.equal(shoreFoamDrive(0.08, 0, SHORE_FOAM.slopeFull, 0, 1), 1);
  assert.equal(shoreFoamDrive(0.08, SHORE_FOAM.washStart, SHORE_FOAM.slopeStart), 0);
});

test('the texture-skip gate conservatively bounds all crest and shelter combinations', () => {
  for (let sea = 0; sea < 2.3; sea += 0.1) for (const foam of [0, 0.02, 0.1, 0.3, 1]) for (const slope of [0, 0.1, 0.3, 0.7]) {
    const potential = shoreFoamDrive(sea, foam, slope);
    for (const crest of [0, 0.2, 0.7, 1]) for (const shelter of [0, 0.5, 1]) {
      const result = shoreFoamDrive(sea, foam, slope, crest, shelter);
      assert.ok(result >= 0 && result <= 1 && result <= potential);
      if (potential === 0) assert.equal(result, 0);
    }
  }
});

test('shoreline response uses existing wake and foam inputs without changing storm caps or precipitation', () => {
  const source = readFileSync(new URL('../src/water.js', import.meta.url), 'utf8');
  assert.ok(source.includes('${SHORE_FOAM_GLSL}'));
  assert.match(source, /shoreSlope = length\(wg\)/);
  assert.match(source, /shoreFoamDrive\(seaState, fmRaw, shoreSlope, crest, shoreShelter\)/);
  assert.match(source, /fm \+= windCaps \* \(0\.35 \+ 0\.65 \* fn2\)/);
  assert.match(source, /fm \+= precipitationCrown \* impactFade/);
  assert.match(SHORE_FOAM_GLSL, /return max\(wind, wash\)/);
  for (const value of Object.values(SHORE_FOAM)) assert.ok(SHORE_FOAM_GLSL.includes(String(value)));
});
