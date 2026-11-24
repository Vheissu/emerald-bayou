import assert from 'node:assert/strict';
import test from 'node:test';
import { findFeedingShelf, ShorebirdFlock } from '../src/shorebirds.js';
import { onGulfCutFlat, buildTidalWrack } from '../src/tidalflat.js';

const bank = { heightAt: (x) => (x - 71.3) * 0.14 };
const boat = { pos: { x: 45, y: -25 }, speed: 0 };
const dt = 1 / 60;
function advance(flock, seconds, tide = 0, fx = {}) {
  for (let i = 0; i < seconds * 60; i++) flock.update(dt, flock.clock + dt, boat, tide, fx);
}

test('the flock finds the tidal shelf and avoids deep channels, bluffs and occupied sites', () => {
  const spot = findFeedingShelf(bank, 69, -25, 0.33, -0.02);
  assert.ok(Math.abs(spot.y - 0.31) < 0.035);
  assert.ok(onGulfCutFlat(spot.x, spot.z));
  assert.equal(findFeedingShelf(bank, 30, -25, 0), null);
  assert.equal(findFeedingShelf({ heightAt: (x) => x }, 0, 0, 0), null);
  assert.equal(
    findFeedingShelf(bank, 71.3, -25, 0, 0, () => true),
    null,
  );
});

test('a disturbance spreads through the flock and each bird lands at the new tide', () => {
  const f = new ShorebirdFlock(bank, 8);
  const rings = [], calls = [];
  const fx = { emitStamp: (...args) => rings.push(args), audio: { willetCall: (...at) => calls.push(at) } };
  advance(f, 2);
  assert.equal(f.mesh.count, 8);
  assert.equal(f.startleNear(0, 200, 12), false);
  assert.equal(f.startleNear(70, -22, 40), true);
  const delays = new Set(f.birds.map((b) => b.left));
  assert.ok(delays.size > 4);
  assert.equal(f.startleNear(70, -22, 40), false);
  advance(f, 0.3, 0, fx);
  assert.ok(f.birds.some((b) => b.state === 'flight'));
  advance(f, 1.6, 0, fx);
  assert.ok(f.birds.every((b) => b.air > 0.9 && b.y > 0.65));
  advance(f, 3, 0.27, fx);
  for (const b of f.birds) {
    assert.ok(b.state !== 'flight' && b.state !== 'alert');
    assert.ok(Math.abs(b.y - bank.heightAt(b.x, b.z)) < 0.03);
    assert.ok(Math.abs(b.y - 0.27) < 0.11);
  }
  assert.ok(rings.length > 0);
  assert.equal(calls.length, 1);
  const oldCount = rings.length;
  f.contact(82, -22, true, fx);
  assert.equal(oldCount, rings.length);
  const oldClock = f.clock;
  f.update(0, 100, boat, 0.6, fx);
  assert.equal(oldClock, f.clock);
  assert.equal(f.level, 0.27);
});

test('water advancing over a resting bird makes it walk uphill', () => {
  const f = new ShorebirdFlock(bank, 4);
  advance(f, 2);
  const startX = f.birds.map((b) => b.x);
  advance(f, 12, 0.31);
  for (const [i, b] of f.birds.entries()) {
    assert.ok(b.x > startX[i] + 1);
    assert.ok(Math.abs(b.y - 0.31) < 0.13);
  }
});

test('the shell and reed drifts stream with the near Gulf Cut tile', () => {
  const c = { level: 0, i: 0, j: -1, sample: bank.heightAt };
  assert.deepEqual(buildTidalWrack({ ...c, level: 1 }, 50, -50), []);
  const wrack = buildTidalWrack(c, 50, -50);
  assert.equal(wrack.length, 2);
  assert.ok(wrack.every((mesh) => mesh.count > 20 && mesh.count < 650 && mesh.receiveShadow));
});
