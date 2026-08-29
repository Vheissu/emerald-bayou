import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirboatPhysics } from '../src/airboat.js';
import { Game, HUD_REFRESH_HZ } from '../src/game.js';
import { Tricks } from '../src/tricks.js';

test('airboat physics reuses retained hull direction vectors', () => {
  const terrain = { heightAt: () => -2, gradAt: (x, z, out) => out.set(0, 0) };
  const hull = new AirboatPhysics(terrain, 0, 0, 0);
  const input = { throttle: 0.7, steer: 0.12, pitch: 0 };
  const forward = hull.forward, right = hull.right;
  let forwardScratch = null, rightScratch = null, implicitDirections = 0;
  hull.forward = function (out) { if (!out) implicitDirections++; forwardScratch ??= out; assert.equal(out, forwardScratch); return forward.call(this, out); };
  hull.right = function (out) { if (!out) implicitDirections++; rightScratch ??= out; assert.equal(out, rightScratch); return right.call(this, out); };

  for (let frame = 0; frame < 600; frame++) hull.update(1 / 60, input, () => 0, frame / 60);

  assert.equal(implicitDirections, 0);
  assert.equal(forwardScratch, hull._f);
  assert.equal(rightScratch, hull._r);
});

test('retained hull collision solver preserves the bow footprint and hit callback', () => {
  const terrain = { heightAt: () => -2, gradAt: (x, z, out) => out.set(0, 0) };
  const hull = new AirboatPhysics(terrain, 0, 0, 0); let callback = null;
  hull.vel.set(0, -8); hull.forward(hull._f); hull.right(hull._r);
  const obstacle = { ax: -2, az: -2.7, bx: 2, bz: -2.7, r: 1, tag: 'dock', onHit: (...args) => { callback = args; } };

  hull.resolveObstacle(obstacle, hull._f);

  assert.ok(hull.hit > 7);
  assert.equal(hull.hitTag, 'dock');
  assert.equal(hull.hitObj, obstacle);
  assert.equal(callback?.[3], hull);
  assert.ok(hull.pos.y > 0);
});

test('trick expiry compacts the retained event list and reuses its direction scratch', () => {
  let implicitDirections = 0, firstScratch = null;
  const phys = {
    airborne: false, airTime: 0, landedFrame: false, speed: 10, heading: 0, vel: new THREE.Vector2(0, -10),
    landFac: 0, hit: 0, nearTrunks: [], pos: new THREE.Vector2(),
    forward(out) { if (!out) implicitDirections++; firstScratch ??= out; assert.equal(out, firstScratch); return out.set(0, -1); },
  };
  const tricks = new Tricks(phys), events = tricks.events;
  tricks.events.push({ text: 'expired', points: 0, t: 2.39 }, { text: 'live', points: 10, t: 0 });

  for (let frame = 0; frame < 600; frame++) tricks.update(1 / 60, frame / 60);

  assert.equal(tricks.events, events);
  assert.equal(tricks.events.length, 0);
  assert.equal(implicitDirections, 0);
  assert.equal(firstScratch, tricks._forward);
});

test('HUD refresh cadence removes four out of five render-frame DOM rebuilds', () => {
  const game = Object.create(Game.prototype); let refreshes = 0;
  game.hudT = 0; game.renderHud = () => { refreshes++; };
  for (let frame = 0; frame < 600; frame++) game.refreshHud(1 / 60);
  assert.equal(refreshes, HUD_REFRESH_HZ * 10);
  assert.equal(refreshes / 600, 0.2);
});
