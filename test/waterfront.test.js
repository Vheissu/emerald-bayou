import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldHeight } from '../src/heightfield.js';
import { AirboatPhysics } from '../src/airboat.js';
import { bridgeCameraHeight } from '../src/waterfrontbridge.js';
import { COVE, GULF_CUT, bridgeOverheadAt, bridgeZAt, swimmerStep, waterfrontColliders, waterfrontGroundOccupied, waterfrontWaterOccupied } from '../src/waterfrontlayout.js';

test('the Gulf Cut bridge provides an unobstructed navigation span and solid piles', () => {
  const { x, z, channelWest, channelEast } = GULF_CUT;
  const h = new WorldHeight(7);
  for (let ox = channelWest + 4; ox <= channelEast - 4; ox += 4) {
    assert.ok(h.compute(ox, bridgeZAt(ox)) < -1.5);
    assert.ok(bridgeOverheadAt(ox, bridgeZAt(ox)) > 8.4);
  }
  assert.ok(waterfrontGroundOccupied(x, z), 'vegetation must stay out of the structure');
  assert.equal(waterfrontWaterOccupied(x, z), false);
  assert.equal(waterfrontWaterOccupied(channelWest, bridgeZAt(channelWest)), true);
  assert.equal(waterfrontWaterOccupied(COVE.x, COVE.z), true);
  assert.ok(bridgeCameraHeight(x, 50, z, 3) < bridgeOverheadAt(x, z));
  assert.equal(bridgeCameraHeight(x, 50, z - 10, 3), 50);

  const terrain = {
    heightAt: (x, z) => h.compute(x, z),
    gradAt: (x, z, out) => out.set((h.compute(x + 1, z) - h.compute(x - 1, z)) / 2, (h.compute(x, z + 1) - h.compute(x, z - 1)) / 2),
  };
  function drive(x) {
    const p = new AirboatPhysics(terrain, x, z + 16, 0);
    p.addObs('waterfront', waterfrontColliders);
    for (let i = 0; i < 670; i++) {
      p.update(1 / 60, { throttle: 0.45, steer: 0, pitch: 0 }, () => 0.2, i / 60);
      if (p.hitTag === 'bridge' && p.hit > 0.1) return { hit: p.hit, z: p.pos.y };
      if (p.pos.y < z - 22) break;
    }
    return { hit: 0, z: p.pos.y };
  }
  assert.ok(drive(channelWest).hit > 1);
  const passage = drive(x);
  assert.equal(passage.hit, 0);
  assert.ok(passage.z < z - 22);
});

test('swimmers finish getting ashore before they return after a wake or storm', () => {
  const s = { mode: 'swim', clearFor: 0 }, input = { dt: 0.1, threat: false, storm: false, dry: false, safe: false, daylight: true };
  assert.equal(swimmerStep(s, { ...input, threat: true }), 'retreat');
  assert.equal(swimmerStep(s, { ...input, dt: 11 }), 'retreat');
  assert.equal(swimmerStep(s, { ...input, safe: true, storm: true }), 'shore');
  assert.equal(swimmerStep(s, { ...input, safe: true, dt: 9 }), 'shore');
  assert.equal(swimmerStep(s, { ...input, safe: true, dt: 2 }), 'swim');
  assert.equal(swimmerStep(s, { ...input, daylight: false }), 'retreat');
});
