import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldHeight } from '../src/heightfield.js';
import { buildRaceCourse } from '../src/racecourse.js';

const openHeight = () => -2;
const clear = () => false;

function everySample(course, at, check) {
  let x = at.x, z = at.z;
  for (const gate of course) {
    for (let sample = 1; sample <= 7; sample++) {
      const q = sample / 7;
      check(x + (gate.x - x) * q, z + (gate.z - z) * q);
    }
    x = gate.x; z = gate.z;
  }
}

test('builds a spaced six-gate course through open water', () => {
  const at = { x: 0, z: 0, heading: 0 }, waterLevel = -0.28;
  const course = buildRaceCourse({ at, waterLevel, heightAt: openHeight, isBlocked: clear });
  assert.equal(course.length, 6); assert.equal(course.at(-1).s, 462);
  assert.deepEqual(course.map(gate => gate.label), Array.from({ length: 6 }, (_, i) => `Gate ${i + 1} of 6`));
  everySample(course, at, (x, z) => assert.ok(waterLevel - openHeight(x, z) >= 0.66));
});

test('turns around an obstruction instead of routing through it', () => {
  const at = { x: 0, z: 0, heading: 0 };
  const barrier = (x, z) => z < -24 && z > -82 && Math.abs(x) < 8;
  const course = buildRaceCourse({ at, waterLevel: 0, heightAt: openHeight, isBlocked: barrier });
  assert.equal(course.length, 6); assert.ok(Math.abs(course[0].x) > 8);
  everySample(course, at, (x, z) => assert.equal(barrier(x, z), false));
});

test('rejects exposed shallows and routes that cannot stay inside the map', () => {
  const at = { x: 0, z: 0, heading: 0 };
  assert.equal(buildRaceCourse({ at, waterLevel: -0.4, heightAt: () => -0.5, isBlocked: clear }), null);
  assert.equal(buildRaceCourse({ at, waterLevel: 0, heightAt: openHeight, isBlocked: () => true }), null);
  assert.equal(buildRaceCourse({ at, waterLevel: 0, heightAt: openHeight, isBlocked: clear, worldHalf: 430 }), null);
});

test('lays a tide-safe course through the procedural main river', () => {
  const height = new WorldHeight(7), z = -700, at = { x: height.riverCenterX(z), z, heading: 0 }, waterLevel = 0;
  const course = buildRaceCourse({ at, waterLevel, heightAt: (x, qz) => height.compute(x, qz), isBlocked: clear });
  assert.equal(course.length, 6);
  everySample(course, at, (x, qz) => assert.ok(waterLevel - height.compute(x, qz) >= 0.66));
});
