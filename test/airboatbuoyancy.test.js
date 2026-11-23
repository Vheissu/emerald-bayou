import test from 'node:test';
import assert from 'node:assert/strict';
import { AirboatPhysics } from '../src/airboat.js';

const openWater = { heightAt: () => -3, gradAt: (x, z, out) => out.set(0, 0) };
const flat = () => 0;
const idle = { throttle: 0, steer: 0, pitch: 0 };
const close = (actual, expected, tolerance) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`);
};

test('the floating hull settles along the water plane in the boat model axes', () => {
  const slopeX = 0.05, slopeZ = -0.03;
  const surface = (x, z) => 0.9 + x * slopeX + z * slopeZ;
  for (const heading of [0, 1.2, -2.3]) {
    const hull = new AirboatPhysics(openWater, 0, 0, heading);
    hull.y = 0.9;
    for (let i = 0; i < 300; i++) hull.update(1 / 60, idle, surface, i / 60);
    const forward = hull.forward(), right = hull.right();
    close(hull.y, 0.9, 0.001);
    close(Math.sin(hull.pitch), forward.x * slopeX + forward.y * slopeZ, 0.001);
    close(Math.sin(hull.roll), -right.x * slopeX - right.y * slopeZ, 0.001);
    assert.equal(hull.airborne, false);
  }
});

test('a wake under the bow or a chine lifts that part of the hull before the wake reaches its centre', () => {
  for (const [isBow, peakAngle] of [[true, 0.05], [false, 0.11]]) {
    const results = [];
    for (const hz of [30, 60, 120]) {
      const hull = new AirboatPhysics(openWater, 0, 0);
      const surface = (x, z, t) => 0.28 * Math.exp(-2 * ((isBow ? z + 2.5 : x + 1.1) ** 2 + (t - 0.7) ** 2 * 16));
      let heave = 0, tilt = 0;
      for (let i = 0; i < hz * 4; i++) {
        hull.update(1 / hz, idle, surface, i / hz);
        heave = Math.max(heave, hull.y);
        tilt = Math.max(tilt, isBow ? hull.pitch : -hull.roll);
        assert.equal(hull.airborne, false);
      }
      assert.ok(heave > (isBow ? 0.04 : 0.08));
      assert.ok(tilt > peakAngle);
      close(hull.y, 0, 0.002);
      close(hull.pitch, 0, 0.002);
      close(hull.roll, 0, 0.002);
      results.push(heave);
    }
    assert.ok(Math.max(...results) - Math.min(...results) < 0.008);
  }
});

test('loading lowers the hull while planing raises it without changing calm-water steering and speed', () => {
  const hull = new AirboatPhysics(openWater, 0, 0);
  hull.loaded = 1;
  for (let i = 0; i < 300; i++) hull.update(1 / 60, idle, flat, i / 60);
  close(hull.y, -0.035, 0.004);
  assert.equal(hull.wet, 1);

  const turningHull = new AirboatPhysics(openWater, 0, 0);
  const drive = { throttle: 1, steer: 0, pitch: 0 };
  for (let i = 0; i < 600; i++) {
    drive.steer = i >= 300 ? 0.5 : 0;
    turningHull.update(1 / 60, drive, flat, i / 60);
  }
  close(turningHull.y, 0.06, 0.012);
  close(turningHull.speed, 13.673, 0.05);
  close(turningHull.heading, 1.196, 0.006);
  assert.equal(turningHull.wet, 1);
});

test('a solid ramp still launches the hull and landing registers on first water contact', () => {
  const elevation = z => z > 0 ? -0.9 : z >= -10 ? -0.9 - z * 0.27 : Math.max(-3, 1.8 + (z + 10) * 0.85);
  const ramp = {
    heightAt: (x, z) => elevation(z),
    gradAt: (x, z, out) => out.set(0, (elevation(z + 0.1) - elevation(z - 0.1)) / 0.2),
  };
  const hull = new AirboatPhysics(ramp, 0, 15);
  hull.vel.y = -13;
  const drive = { ...idle, throttle: 1 };
  let launched = false, landed = false;
  for (let i = 0; i < 240; i++) {
    hull.update(1 / 60, drive, flat, i / 60);
    launched ||= hull.takeoffFrame && hull.vy > 3;
    if (hull.landedFrame) {
      assert.equal(launched, true);
      assert.ok(hull.airTime > 0.9 && hull.airPeak > 2.5);
      assert.equal(hull.landQuality, 'clean');
      assert.ok(hull.impact > 5 && hull.y > 0.45 && hull.wet < 0.2);
      landed = true;
      break;
    }
  }
  assert.equal(landed, true);
});
