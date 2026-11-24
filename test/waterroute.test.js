import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldHeight } from '../src/heightfield.js';
import { World } from '../src/world.js';
import { measureRoute, planWaterRoute, routeProgress } from '../src/waterroute.js';

const pathLength = p => measureRoute(p.points).length;

test('a plotted course goes around an island and keeps both sides of the hull in water', () => {
  const heightAt = (x, z) => Math.hypot(x, z) < 25 ? 2 : -4;
  const result = planWaterRoute({ start: { x: -70, z: 0 }, target: { x: 70, z: 0 }, heightAt, limit: 100 });
  assert.equal(result.status, 'ready');
  assert.ok(result.points.length > 2);
  assert.ok(pathLength(result) > 148);
  for (let i = 1; i < result.points.length; i++) {
    const a = result.points[i - 1], b = result.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    for (let d = 0; d <= length; d++) {
      for (const offset of [-1, 0, 1]) {
        assert.ok(heightAt(a.x + (dx * d - dz * offset) / length, a.z + (dz * d + dx * offset) / length) < 0);
      }
    }
  }
});

test('a direct course respects a bridge pier and leaves room to pass alongside it', () => {
  const args = { start: { x: 0, z: -50 }, target: { x: 0, z: 45 }, heightAt: () => -4, limit: 100 };
  const open = planWaterRoute(args);
  assert.equal(pathLength(open), 95);
  const pier = planWaterRoute({ ...args, obstacles: [{ x: 0, z: 1.5, r: 1 }] });
  assert.equal(pier.status, 'ready');
  assert.ok(pier.points.length > 2);
  for (const p of pier.points.slice(1, -1)) assert.ok(Math.hypot(p.x, p.z - 1.5) > 2.3);
});

test('a shelf opens at high water and leaves disconnected pools unreachable at low water', () => {
  const heightAt = x => Math.abs(x) < 20 ? -0.34 : -2;
  const args = { start: { x: -30, z: 0 }, target: { x: 30, z: 0 }, heightAt, limit: 80 };
  assert.equal(planWaterRoute({ ...args, waterLevel: -0.2 }).status, 'unreachable');
  const high = planWaterRoute({ ...args, waterLevel: 0.4 });
  assert.equal(high.status, 'ready');
  assert.equal(pathLength(high), 60);
});

test('a shore pin ends at its usable water approach', () => {
  const result = planWaterRoute({
    start: { x: 0, z: 0 }, target: { x: 65, z: 0 }, limit: 150,
    heightAt: x => x <= 55 ? -3 : 1,
  });
  assert.equal(result.status, 'ready');
  assert.ok(result.points.at(-1).x <= 55);
  assert.ok(result.destinationOffset >= 10 && result.destinationOffset < 24);
});

test('progress measures along the plotted segments and changes turn cue after the junction', () => {
  const points = [{ x: 0, z: 100 }, { x: 0, z: 50 }, { x: 60, z: 50 }, { x: 60, z: -10 }];
  const route = { points, ...measureRoute(points) };
  assert.equal(route.length, 170);
  const before = routeProgress(route, 0, 80);
  assert.equal(before.remaining, 150);
  assert.deepEqual(before.turn, { index: 1, distance: 50, direction: 'right', degrees: 90, remaining: 30 });
  const after = routeProgress(route, 20, 50, before.segment);
  assert.equal(after.remaining, 100);
  assert.equal(after.turn.direction, 'left');
  assert.equal(after.turn.remaining, 40);
});

test('a trip from the starting river to Mullet Bend crosses the channels instead of the bank', () => {
  const hf = new WorldHeight(7), world = new World({ hf }, null, null);
  const camp = world.campAt(-1, 0), start = { x: hf.riverCenterX(70), z: 70 };
  const result = planWaterRoute({
    start, target: camp.tie, heightAt: (x, z) => hf.compute(x, z), obstacles: world.campColliders(camp),
  });
  assert.equal(result.status, 'ready');
  assert.ok(Math.hypot(result.points.at(-1).x - camp.tie.x, result.points.at(-1).z - camp.tie.z) < 25);
  assert.ok(pathLength(result) > 1800 && pathLength(result) < 3000);
  assert.ok(measureRoute(result.points).turns.length > 2);
});
