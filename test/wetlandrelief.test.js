import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldHeight } from '../src/heightfield.js';
import { World } from '../src/world.js';

test('wooded ridges rise behind the channel while submerged beds and tower foundations retain their elevations', () => {
  const hf = new WorldHeight(7);
  let submerged = 0, lowBanks = 0, highGround = 0;
  for (let z = -480; z <= 480; z += 12) for (let x = -300; x <= 300; x += 12) {
    const { h, floodplainHeight } = hf.computeBase(x, z);
    if (floodplainHeight < 0) { assert.equal(h, floodplainHeight); submerged++; }
    if (h > 0 && h < 1.5) lowBanks++;
    if (h > 6 && h - floodplainHeight > 3) highGround++;
  }
  assert.ok(submerged > 500 && lowBanks > 500 && highGround > 200);
  const island = hf.computeBase(hf.island.x, hf.island.y);
  assert.equal(island.h, island.floodplainHeight);
});

test('charted camps and homesteads keep their seeded positions and sit on the sculpted ground', () => {
  const hf = new WorldHeight(7), world = new World({ hf }, null, null);
  const camp = world.campAt(-1, 0);
  assert.equal(camp.name, 'Mullet Bend');
  assert.ok(Math.abs(camp.x + 572.5501) < 0.001 && Math.abs(camp.z - 1055.2708) < 0.001);
  assert.equal(camp.h, hf.compute(camp.x, camp.z));
  assert.ok(hf.compute(camp.tie.x, camp.tie.z) < -1);
  const house = world.siteAt(-1, 1);
  assert.equal(house.kind, 'house');
  assert.ok(Math.abs(house.x + 209.6233) < 0.001 && Math.abs(house.z - 1275.8176) < 0.001);
  assert.equal(house.h, hf.compute(house.x, house.z));
});
