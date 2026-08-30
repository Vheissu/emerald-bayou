import test from 'node:test';
import assert from 'node:assert/strict';
import { downburstCraftUrgency } from '../src/downburst.js';

const previousDocument = globalThis.document;
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, fillText() {}, strokeRect() {} }),
  }),
};
const { Traffic } = await import('../src/life.js');
if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;

function trafficBoat(x) {
  return {
    x, z: 0, heading: 0, kind: 'john', profile: { essential: false }, state: 'transit',
    downburstField: {}, downburstResponse: 0, downburstDistance: Infinity, downburstNoticeT: 0,
    downburstReactionDelay: 1.2, downburstReacted: false,
    localOutflow: { x: 0, z: 0 }, surfaceWind: { x: 0, z: 0, speed: 0 },
    windage: 0.023, windDivergence: 0, windDrift: { x: 0, z: 0, speed: 0 }, windHeelScale: 0.9, windHeel: 0,
  };
}

test('traffic retains one downburst sample for delayed AI, leeway and hull heel', () => {
  const cell = { active: true, x: 0, z: 0, age: 12, duration: 48, startRadius: 12, maxRadius: 126, peakWind: 24, biasX: 1, biasZ: 0 };
  const radius = downburstCraftUrgency(cell, 0, 0, 'john', {}).radius;
  const boat = trafficBoat(radius), field = boat.downburstField, wind = boat.surfaceWind, drift = boat.windDrift;
  const traffic = Object.create(Traffic.prototype); traffic.hazards = { downburst: cell };

  assert.ok(traffic.updateDownburstResponse(boat, 1 / 30, false) > 0);
  assert.equal(boat.downburstReacted, true); assert.equal(boat.downburstField, field); assert.ok(field.speed > 23);
  assert.equal(traffic.updateSurfaceWind(boat, { x: 0, z: 1 }, 10), wind);
  assert.equal(boat.surfaceWind, wind); assert.equal(boat.windDrift, drift); assert.ok(wind.speed > 25);
  assert.ok(drift.speed > 0.5); assert.notEqual(boat.windHeel, 0);

  const beforeBlocked = boat.downburstResponse;
  traffic.updateDownburstResponse(boat, 0.5, true);
  assert.ok(boat.downburstResponse < beforeBlocked); assert.ok(field.speed > 23);
  cell.active = false; traffic.updateDownburstResponse(boat, 1, false); traffic.updateSurfaceWind(boat, { x: 0, z: 1 }, 10);
  assert.equal(field.speed, 0); assert.equal(boat.downburstDistance, Infinity); assert.equal(wind.speed, 10);
});
