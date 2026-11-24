import assert from 'node:assert/strict';
import test from 'node:test';
import { createDockShift, stepDockShift } from '../src/skiffdockshift.js';
import { COVE_MOORINGS } from '../src/waterfrontlayout.js';

const dt = 0.02;

function finishLoading(shift, trip) {
  const walked = new Set();
  let helmCleared = false;
  for (let t = 0; t < 23 && !shift.ready; t += dt) {
    stepDockShift(shift, trip, dt);
    walked.add(shift.helm.action);
    if (shift.helm.from.space === 'boat' && shift.helm.to.space === 'boat') helmCleared = true;
    if (shift.angler.from.space === 'dock' && shift.angler.to.space === 'boat') assert.ok(helmCleared);
  }
  assert.ok(shift.ready);
  for (const action of ['lift', 'carry', 'board', 'lower', 'seat']) assert.ok(walked.has(action), action);
}

test('the two crews carry their own gear across the proper dock face and take their seats', () => {
  for (const [index, berth] of COVE_MOORINGS.entries()) {
    const shift = createDockShift(berth, index);
    const trip = { secured: true, timer: 15, storm: false, catchCount: 0 };
    assert.equal(shift.gear.cooler.owner, 'dock');
    finishLoading(shift, trip);
    assert.equal(shift.phase, 'aboard');
    assert.equal(shift.gear.cooler.owner, 'boat');
    assert.equal(shift.gear.tackle.owner, 'boat');
    assert.deepEqual(shift.helm.from, { space: 'boat', x: -0.21, y: 0.064, z: 1.23 });
    assert.deepEqual(shift.angler.from, { space: 'boat', x: 0.02, y: 0.073, z: -0.95 });
    for (const route of Object.values(shift.routes)) {
      const crossing = route.steps.find(s => s.from.space === 'dock' && s.to.space === 'boat');
      assert.equal(crossing.from.x, berth.x);
      assert.equal(Math.sign(crossing.from.z - berth.pier.z), berth.side);
      assert.equal(Math.sign(crossing.to.x), -berth.side);
    }
  }
});

test('a warning at the gunwale reverses the continuous crossing, returns gear and holds the crew under cover', () => {
  const shift = createDockShift(COVE_MOORINGS[0], 0);
  const trip = { secured: true, timer: 5, storm: false, catchCount: 0 };
  const edge = shift.routes.helm.steps.find(s => s.from.space === 'dock' && s.to.space === 'boat').start;
  stepDockShift(shift, trip, edge + 0.34);
  const pre = [shift.helm.from, shift.helm.to, shift.helm.progress];
  assert.equal(shift.helm.action, 'board');
  assert.equal(shift.gear.cooler.owner, 'helm');
  trip.storm = true;
  stepDockShift(shift, trip, 0.00001);
  assert.equal(shift.helm.action, 'step-off');
  assert.equal(shift.helm.from, pre[1]);
  assert.equal(shift.helm.to, pre[0]);
  assert.ok(Math.abs(shift.helm.progress + pre[2] - 1) < 0.00005);
  const beforePause = shift.elapsed;
  stepDockShift(shift, trip, 0);
  assert.equal(shift.elapsed, beforePause);
  for (let t = 0; t < 24; t += dt) stepDockShift(shift, trip, dt);
  assert.equal(shift.phase, 'sheltered');
  assert.equal(shift.ready, false);
  assert.equal(shift.helm.action, 'shelter');
  assert.equal(shift.angler.action, 'shelter');
  assert.equal(shift.gear.cooler.owner, 'dock');
  assert.equal(shift.gear.tackle.owner, 'dock');
  trip.storm = false;
  finishLoading(shift, trip);
});

test('catch rides in the same tote, then is sorted onto the pier without duplicating fish', () => {
  const shift = createDockShift(COVE_MOORINGS[0], 0);
  const trip = { secured: true, timer: 2, storm: false, catchCount: 0 };
  finishLoading(shift, trip);
  trip.secured = false;
  trip.phase = 'fishing';
  trip.catchCount = 3;
  stepDockShift(shift, trip, dt);
  const gear = shift.gear.cooler;
  assert.equal(gear.count, 3);
  assert.equal(gear.owner, 'boat');
  assert.ok(gear.open > 0);
  trip.secured = true;
  trip.timer = 38;
  trip.phase = 'berthed';
  const owners = new Set();
  let sorted = 0;
  for (let t = 0; t < 25; t += dt) {
    const landed = shift.landedCount;
    stepDockShift(shift, trip, dt);
    owners.add(gear.owner);
    if (gear.owner === 'boat' || gear.owner === 'helm') assert.equal(gear.count, 3);
    if (shift.sorting) {
      assert.equal(shift.helm.action, 'sort');
      assert.equal(shift.helm.from.x, COVE_MOORINGS[0].pier.x + 2.93);
      assert.equal(gear.owner, 'dock');
      assert.ok(gear.open > 0.8);
      if (shift.landedCount > landed) sorted++;
    }
  }
  assert.equal(sorted, 3);
  assert.deepEqual(owners, new Set(['boat', 'helm', 'dock']));
  assert.equal(gear, shift.gear.cooler);
  assert.equal(gear.point.space, 'dock');
  assert.equal(gear.point.y, COVE_MOORINGS[0].pier.deck + 0.82);
  assert.equal(gear.count, 0);
  assert.equal(shift.landedCount, 3);
  assert.equal(shift.phase, 'waiting');

  trip.catchCount = 0;
  stepDockShift(shift, trip, 1);
  assert.equal(shift.landedCount, 3);
  trip.timer = 5;
  finishLoading(shift, trip);
  assert.equal(gear.count, 0);
  assert.equal(shift.landedCount, 3);
});

test('a secured boat waits for daylight with its crew on the dock', () => {
  const shift = createDockShift(COVE_MOORINGS[1], 1);
  const trip = { secured: true, timer: 0, storm: false, catchCount: 0 };
  stepDockShift(shift, trip, 5, 0.15);
  assert.equal(shift.phase, 'sheltered');
  assert.equal(shift.helm.from.space, 'dock');
  assert.equal(shift.ready, false);
  finishLoading(shift, trip);
});

test('an empty outing still unloads its own gear without a sorting task', () => {
  const shift = createDockShift(COVE_MOORINGS[1], 1);
  const trip = { secured: true, timer: 0, storm: false, catchCount: 0 };
  finishLoading(shift, trip);
  trip.secured = false;
  stepDockShift(shift, trip, dt);
  trip.secured = true;
  trip.storm = true;
  for (let t = 0; t < 22; t += dt) {
    stepDockShift(shift, trip, dt);
    assert.equal(shift.sorting, false);
  }
  assert.equal(shift.phase, 'sheltered');
  assert.equal(shift.landedCount, 0);
  assert.equal(shift.gear.cooler.owner, 'dock');
});

test('the next haul fills a fresh tray while a previous delivery stays visible through departure', () => {
  const shift = createDockShift(COVE_MOORINGS[1], 1);
  const trip = { secured: true, timer: 2, storm: false, catchCount: 0, phase: 'berthed' };
  for (const previous of [0, 4]) {
    trip.secured = true;
    trip.timer = 2;
    finishLoading(shift, trip);
    assert.equal(shift.landedCount, previous);

    trip.secured = false;
    trip.catchCount = 0;
    trip.phase = 'outbound';
    stepDockShift(shift, trip, dt);
    assert.equal(shift.landedCount, previous);

    trip.phase = 'fishing';
    trip.catchCount = 4;
    stepDockShift(shift, trip, dt);
    assert.equal(shift.landedCount, 0);

    trip.secured = true;
    trip.timer = 42;
    trip.phase = 'berthed';
    const counts = new Set();
    for (let time = 0; time < 25; time += dt) {
      stepDockShift(shift, trip, dt);
      counts.add(shift.landedCount);
      if (shift.sorting) assert.ok(Math.cos(shift.helm.facing) < -0.8, 'southern helm faces its tabletop');
    }
    assert.deepEqual([...counts], [0, 1, 2, 3, 4]);
    assert.equal(shift.gear.cooler.count, 0);
  }
});
