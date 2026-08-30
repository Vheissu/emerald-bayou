import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Gators, alligatorHookedFishRange } from '../src/wildlife.js';

function testGator(x, z, overrides = {}) {
  const mesh = new THREE.Object3D(); mesh.scale.setScalar(overrides.scale || 1);
  return {
    mesh, pos: new THREE.Vector3(x, -0.55, z), float: -0.55, heading: 0, speed: 0.5, ph: 0.4,
    dive: 0, big: false, hitT: 0, bask: false, slide: 0, charge: 0, chargeCd: 0, bellowT: 30,
    wakeKick: 0, wakeSpeed: 0, preySource: null, preyT: 0, preyCooldown: 0, preyDistance: Infinity,
    ...overrides,
  };
}

test('larger fish splashes carry farther without creating an unlimited attraction radius', () => {
  const quietBluegill = alligatorHookedFishRange(0.25, 0.25, 0.8);
  const runningTarpon = alligatorHookedFishRange(1, 1, 1.55);
  assert.ok(quietBluegill > 25 && quietBluegill < 35);
  assert.ok(runningTarpon > quietBluegill && runningTarpon < 55);
  assert.ok(alligatorHookedFishRange(99, 99, 99) < 60);
});

test('a hooked fish attracts only the nearest eligible gator over a clear water path', () => {
  const basking = testGator(7, 0, { bask: true }), nearest = testGator(27, 0), farther = testGator(38, 0);
  const director = Object.create(Gators.prototype); director.T = { heightAt: () => -2 }; director.list = [basking, farther, nearest];
  const cleared = [], source = { state: 'fight', session: { species: { power: 0.85 } }, clearAlligatorThreat(gator) { cleared.push(gator); } };

  assert.equal(director.attractToHookedFish(source, 0, 0, 0.9, 0), nearest);
  assert.equal(nearest.preySource, source); assert.equal(nearest.preyT, 14);
  nearest.preyT = 2; assert.equal(director.attractToHookedFish(source, 0, 0, 0.9, 0), nearest); assert.equal(nearest.preyT, 12);
  director.releaseHookedFish(source); assert.equal(nearest.preySource, null); assert.deepEqual(cleared, [nearest]);

  const blockedDirector = Object.create(Gators.prototype); blockedDirector.list = [testGator(30, 0)];
  blockedDirector.T = { heightAt: x => (x > 8 && x < 22 ? 0.2 : -2) };
  assert.equal(blockedDirector.attractToHookedFish(source, 0, 0, 1, 0), null);
});

test('an attracted gator closes on the moving fight target and takes it once', () => {
  const gator = testGator(0, 6), distances = [];
  const source = {
    state: 'fight', session: { x: 0, z: 0, species: { power: 0.8 } }, taken: 0,
    trackAlligatorThreat(active, distance) { assert.equal(active, gator); distances.push(distance); },
    alligatorTake(active) { assert.equal(active, gator); this.taken++; this.state = 'idle'; },
    clearAlligatorThreat() {},
  };
  gator.preySource = source; gator.preyT = 10;
  const director = Object.create(Gators.prototype);
  Object.assign(director, { T: { heightAt: () => -2 }, list: [gator], activity: 1, rand: () => 0.5, eyeshinePool: { update() {} }, wakeBoatX: 0, wakeBoatZ: 0 });

  for (let frame = 0; frame < 180 && !source.taken; frame++) director.update(1 / 60, frame / 60, 18, 0, 0, 0, false, 0, 0, 0, 0);

  assert.equal(source.taken, 1); assert.ok(distances.length > 0); assert.ok(distances.at(-1) < distances[0]);
  assert.equal(gator.preySource, null); assert.ok(gator.dive > 7); assert.ok(gator.wakeKick >= 1.3); assert.ok(gator.preyCooldown >= 37);
});
