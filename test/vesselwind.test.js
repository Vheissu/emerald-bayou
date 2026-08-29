import test from 'node:test';
import assert from 'node:assert/strict';
import { airboatWindLoad, applyAirboatWind, vesselLeeway, vesselWindHeel } from '../src/vesselwind.js';
import { AirboatPhysics } from '../src/airboat.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const boat = overrides => ({ heading: 0, vel: { x: 0, y: 0 }, wet: 1, loaded: 0, damageLoad: 0, angVel: 0, ...overrides });

test('beam-wind load is quadratic and weathercocks the fan cage into the wind', () => {
  const hull = boat(), ten = airboatWindLoad({ x: 1, z: 0 }, 10, hull, {}), twenty = airboatWindLoad({ x: 1, z: 0 }, 20, hull, {});
  assert.ok(ten.ax > 0);
  close(ten.az, 0);
  close(twenty.ax / ten.ax, 4);
  assert.ok(twenty.yaw > 0, 'stern load should turn a northbound bow toward wind coming from the west');
  assert.ok(twenty.heel > 0);
  close(twenty.apparentSpeed, 20);
});

test('apparent wind distinguishes a headwind from a following wind', () => {
  const hull = boat({ vel: { x: 0, y: -10 } });
  const headwind = airboatWindLoad({ x: 0, z: 1 }, 15, hull, {});
  const following = airboatWindLoad({ x: 0, z: -1 }, 15, hull, {});
  assert.ok(headwind.az > 0, 'headwind should oppose forward travel');
  assert.ok(following.az < 0, 'a following wind faster than the hull should add forward drive');
  close(headwind.yaw, 0);
  close(following.yaw, 0);
});

test('passenger and damage mass reduce the same gust load', () => {
  const light = airboatWindLoad({ x: 1, z: 0 }, 30, boat(), {});
  const heavy = airboatWindLoad({ x: 1, z: 0 }, 30, boat({ loaded: 2, damageLoad: 0.6 }), {});
  assert.ok(heavy.ax < light.ax);
  assert.ok(heavy.yaw < light.yaw);
  assert.ok(heavy.heel < light.heel);
});

test('applying wind reuses caller state and exposes the physical load for debugging', () => {
  const hull = boat(), scratch = {};
  const result = applyAirboatWind(hull, { x: 1, z: 0 }, 36, 1 / 30, scratch);
  assert.equal(result, scratch);
  assert.ok(hull.vel.x > 0);
  assert.ok(hull.angVel > 0);
  assert.equal(hull.windHeel, result.heel);
  assert.equal(hull.apparentWind, result.apparentSpeed);
  assert.equal(hull.crosswind, result.crosswind);
});

test('airboat attitude follows the retained gust heel and reset clears it', () => {
  const terrain = { heightAt: () => -2, gradAt: (x, z, out) => out.set(0, 0) };
  const hull = new AirboatPhysics(terrain, 0, 0, 0), input = { throttle: 0, steer: 0, pitch: 0 };
  for (let i = 0; i < 120; i++) { hull.windHeel = 0.08; hull.update(1 / 60, input, () => 0, i / 60); }
  assert.ok(hull.roll > 0.06 && hull.roll < 0.09);
  hull.apparentWind = 36; hull.crosswind = -36; hull.reset(0, 0, 0);
  assert.equal(hull.windHeel, 0);
  assert.equal(hull.apparentWind, 0);
  assert.equal(hull.crosswind, 0);
});

test('persistent craft keep a bounded left or right leeway track', () => {
  const left = {}, right = {};
  assert.equal(vesselLeeway({ x: 1, z: 0 }, 20, 0.02, Math.PI / 9, left), left);
  vesselLeeway({ x: 1, z: 0 }, 20, 0.02, -Math.PI / 9, right);
  close(Math.hypot(left.x, left.z), 0.4);
  close(Math.hypot(right.x, right.z), 0.4);
  close(Math.atan2(left.z, left.x), Math.PI / 9);
  close(Math.atan2(right.z, right.x), -Math.PI / 9);
  assert.ok(vesselWindHeel({ x: 1, z: 0 }, 36, 0, 1) > 0);
  close(vesselWindHeel({ x: 0, z: 1 }, 36, 0, 1), 0);
});

test('calm and invalid wind inputs clear retained outputs safely', () => {
  const out = { x: 9, z: 9, speed: 9 };
  vesselLeeway(null, Number.NaN, 0.02, 0, out);
  assert.deepEqual(out, { x: 0, z: 0, speed: 0 });
  const load = airboatWindLoad(null, 0, boat(), { ax: 9 });
  assert.deepEqual(load, { ax: 0, az: 0, yaw: 0, heel: 0, apparentSpeed: 0, crosswind: 0 });
});
