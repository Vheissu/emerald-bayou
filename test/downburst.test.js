import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downburstCanForm, downburstCraftUrgency, downburstFormationChance, downburstProbeScore,
  downburstReactionReady, downburstSurfaceState,
} from '../src/downburst.js';

const severe = { storm: 0.92, rain: 1, hail: 0.08, lightning: 0.9, wind: 18 };

test('wet downbursts require a convective rain core', () => {
  assert.equal(downburstFormationChance('fair', severe), 0);
  assert.equal(downburstFormationChance('thunderstorm', { ...severe, storm: 0.5 }), 0);
  assert.equal(downburstFormationChance('thunderstorm', { ...severe, rain: 0.2 }), 0);
  const thunder = downburstFormationChance('thunderstorm', severe);
  assert.ok(thunder > 0.3 && thunder < 0.68);
  assert.ok(downburstFormationChance('hail', { ...severe, hail: 1 }) > thunder);
  assert.equal(downburstCanForm('thunderstorm', severe, thunder - 0.01), true);
  assert.equal(downburstCanForm('thunderstorm', severe, thunder + 0.01), false);
});

test('surface outflow diverges from the rain core and peaks at the rain foot', () => {
  const cell = { x: 10, z: -20, age: 12, duration: 48, startRadius: 12, maxRadius: 126, peakWind: 24, biasX: 0, biasZ: 1 };
  const center = downburstSurfaceState(cell, cell.x, cell.z, {}), radius = center.radius;
  const east = downburstSurfaceState(cell, cell.x + radius, cell.z, {});
  const west = downburstSurfaceState(cell, cell.x - radius, cell.z, {});
  assert.ok(east.rainFoot > 0.9);
  assert.ok(east.intensity > 0.9);
  assert.ok(east.windX > 20);
  assert.ok(west.windX < -20);
  assert.ok(Math.abs(east.windZ) < Math.abs(east.windX));
  assert.ok(center.coreRain > 0.9);
  assert.ok(center.intensity < 1e-6);
});

test('the caller-owned field is reused and falls quiet outside its bounded lifecycle', () => {
  const out = {}, cell = { x: 0, z: 0, age: 0, duration: 40, maxRadius: 110, peakWind: 22, biasX: 1, biasZ: 0 };
  assert.equal(downburstSurfaceState(cell, 12, 0, out), out);
  assert.equal(out.intensity, 0);
  cell.age = 18;
  downburstSurfaceState(cell, 400, 0, out);
  assert.ok(out.intensity < 1e-6);
  cell.age = 40;
  downburstSurfaceState(cell, 110, 0, out);
  assert.equal(out.lifecycle, 0);
  assert.equal(out.windX, 0);
  assert.equal(out.windZ, 0);
});

test('open small craft notice the approaching rain foot before enclosed cruisers', () => {
  const cell = { active: true, x: 0, z: 0, age: 12, duration: 48, startRadius: 12, maxRadius: 126, peakWind: 24, biasX: 1, biasZ: 0 };
  const center = downburstCraftUrgency(cell, 0, 0, 'john', {}), x = center.radius + center.width * 1.8;
  const out = {}, canoe = downburstCraftUrgency(cell, x, 0, 'canoe', out);
  const canoeUrgency = canoe.urgency;
  assert.equal(canoe, out); assert.ok(canoe.visualWarning > 0.5); assert.ok(canoe.intensity < 0.01);
  const cruiser = downburstCraftUrgency(cell, x, 0, 'cruiser', {});
  assert.ok(canoeUrgency > cruiser.urgency); assert.ok(cruiser.urgency > 0.2);
});

test('distant rain-foot recognition is delayed but a severe gust triggers an immediate reaction', () => {
  const cell = { active: true, x: 0, z: 0, age: 12, duration: 48, startRadius: 12, maxRadius: 126, peakWind: 24, biasX: 1, biasZ: 0 };
  const center = downburstCraftUrgency(cell, 0, 0, 'john', {});
  const warning = downburstCraftUrgency(cell, center.radius + center.width * 1.8, 0, 'john', {});
  assert.equal(downburstReactionReady(warning, 0.2, 1), false);
  assert.equal(downburstReactionReady(warning, 1, 1), true);
  const gust = downburstCraftUrgency(cell, center.radius, 0, 'john', {});
  assert.equal(downburstReactionReady(gust, 0, 1.5), true);
});

test('probe steering rejects a shortcut through the core and prefers a safer escape lane', () => {
  const cell = { active: true, x: 0, z: 0, age: 12, duration: 48, startRadius: 12, maxRadius: 126, peakWind: 24, biasX: 1, biasZ: 0 };
  const current = downburstCraftUrgency(cell, 0, 0, 'john', {}), x = current.radius;
  downburstCraftUrgency(cell, x, 0, 'john', current);
  const scratch = {};
  const outward = downburstProbeScore(cell, current, x + 48, 0, 1, 0, 'john', 1, scratch);
  const inward = downburstProbeScore(cell, current, x - 48, 0, -1, 0, 'john', 1, scratch);
  const quartering = downburstProbeScore(cell, current, x, 48, 0, 1, 'john', 1, scratch);
  assert.ok(outward > inward); assert.ok(quartering > inward); assert.ok(outward > 0); assert.ok(inward < 0);
});
