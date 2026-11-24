import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldHeight } from '../src/heightfield.js';
import { COVE_MOORINGS } from '../src/waterfrontlayout.js';
import { createFishingTrip, stepFishingTrip } from '../src/skifffishingtrip.js';

const terrain = new WorldHeight();
const waterLevel = -.4;
const cut = { waterLevel, heightAt: terrain.compute.bind(terrain) };
const dt = .05;
const runFor = (trip, seconds, context = cut) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) stepFishingTrip(trip, dt, context);
};

test('both skiffs leave their own piers, fish navigable water and back into the same berth', () => {
  const starts = [];
  for (const [index, berth] of COVE_MOORINGS.entries()) {
    const trip = createFishingTrip(berth, index), phases = [trip.phase];
    let bridgeX;
    for (let elapsed = 0; elapsed < 210; elapsed += dt) {
      const { x, z, phase } = trip;
      stepFishingTrip(trip, dt, cut);
      assert.ok(Math.hypot(trip.x - x, trip.z - z) < .35, 'position is continuous at every phase change');
      const fwX = -Math.sin(trip.heading), fwZ = -Math.cos(trip.heading);
      for (const reach of [0, -1.4, 1.6]) {
        const depth = waterLevel - cut.heightAt(trip.x + fwX * reach, trip.z + fwZ * reach);
        assert.ok(depth > .50, 'clearance for the full boat at low tide');
      }
      if (phase !== trip.phase) {
        phases.push(trip.phase);
        if (trip.phase === 'departing') starts.push(elapsed);
        if (trip.phase === 'fishing') assert.ok(Math.hypot(trip.x - trip.station.x, trip.z - trip.station.z) < .02);
        if (trip.phase === 'berthed') break;
      }
      if (z >= -58 && trip.z < -58) bridgeX = trip.x;
    }
    assert.deepEqual(phases, ['berthed', 'departing', 'outbound', 'fishing', 'returning', 'docking', 'berthed']);
    assert.equal(trip.x, berth.x);
    assert.equal(trip.z, berth.z);
    assert.ok(Math.abs(trip.heading + Math.PI / 2) < .015, 'bow out along the pier');
    assert.equal(trip.secured, true);
    if (index === 1) assert.ok(bridgeX > 4 && bridgeX < 12, 'stays inside the marked bridge opening');
  }
  assert.ok(starts[0] > 12 && starts[1] - starts[0] > 7);
});

test('the crew reels in at a forecast squall, ties up and waits for sustained clear weather', () => {
  const trip = createFishingTrip(COVE_MOORINGS[0], 0);
  runFor(trip, 42);
  assert.equal(trip.phase, 'fishing');
  runFor(trip, dt, { ...cut, stormApproaching: true });
  assert.equal(trip.phase, 'returning');
  assert.equal(trip.storm, true);
  runFor(trip, 40, { ...cut, storm: .75, wind: 22 });
  assert.equal(trip.phase, 'berthed');
  assert.equal(trip.secured, true);
  const waiting = trip.timer;
  runFor(trip, 14);
  assert.equal(trip.timer, waiting);
  runFor(trip, 74);
  assert.notEqual(trip.phase, 'berthed');
  assert.equal(trip.storm, false);
});

test('a storm on the outbound leg brakes the hull before it reverses course', () => {
  const trip = createFishingTrip(COVE_MOORINGS[0], 0);
  runFor(trip, 27);
  const before = trip.progress;
  assert.ok(trip.speed > 3);
  runFor(trip, dt, { ...cut, storm: .78 });
  assert.equal(trip.phase, 'returning');
  assert.ok(trip.progress > before, 'briefly carries forward momentum while throttling down');
  runFor(trip, 40, { ...cut, storm: .78 });
  assert.equal(trip.phase, 'berthed');
});

test('fast approaches and their trailing wake startle a fishing crew without cancelling their outing', () => {
  const trip = createFishingTrip(COVE_MOORINGS[0], 0);
  runFor(trip, 42);
  const { x, z } = trip;
  runFor(trip, .5, { ...cut, player: { x: x + 22, z, vx: -12, vz: 0 } });
  assert.ok(trip.alarm > .7);
  assert.equal(trip.reaction, 'brace');
  assert.equal(trip.phase, 'fishing');
  runFor(trip, 2.2, { ...cut, player: { x: x - 22, z, vx: -12, vz: 0 } });
  assert.equal(trip.alarm, 0, 'no panic once the boat is outside the collision track');
  runFor(trip, .3, { ...cut, player: { x: x - 24, z, vx: -12, vz: 0 }, wake: -.16 });
  assert.ok(trip.alarm > .7, 'trailing troughs also trigger a brace');
});

test('a slow approach gets one watch and hail until the player gives the crew some space', () => {
  const trip = createFishingTrip(COVE_MOORINGS[0], 0);
  runFor(trip, 42);
  const close = { ...cut, player: { x: trip.x + 8, z: trip.z, vx: -.8, vz: 0 } };
  runFor(trip, .15, close);
  assert.equal(trip.reaction, 'watch');
  runFor(trip, .5, close);
  assert.equal(trip.reaction, 'hail');
  runFor(trip, 4, close);
  assert.equal(trip.reaction, '');
  runFor(trip, 4);
  runFor(trip, .3, close);
  assert.equal(trip.reaction, 'watch');
  runFor(trip, .25, { ...close, contactHold: .8 });
  assert.equal(trip.reaction, 'brace');
});

test('the skipper stays tied while the pier approach is occupied and steers around open water traffic', () => {
  const trip = createFishingTrip(COVE_MOORINGS[0], 0), berth = trip.berth;
  runFor(trip, 19, { ...cut, player: { x: berth.x + 5.5, z: berth.z, speed: 0 } });
  assert.equal(trip.phase, 'berthed');
  assert.equal(trip.secured, true);
  let separation = Infinity;
  const player = { x: 11.6, z: 54, speed: 0 };
  for (let i = 0; i < 800; i++) {
    stepFishingTrip(trip, dt, { ...cut, player });
    separation = Math.min(separation, Math.hypot(player.x - trip.x, player.z - trip.z));
  }
  assert.ok(separation > 4);
  assert.equal(trip.phase, 'fishing');
});
