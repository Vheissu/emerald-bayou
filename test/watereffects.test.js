import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Spray, Plume } from '../src/particles.js';
import { AirboatPhysics } from '../src/airboat.js';
import { configureModelLoading } from '../src/models.js';

const gradient = () => ({ addColorStop() {} });
const context = { createRadialGradient: gradient, beginPath() {}, arc() {}, fill() {}, fillRect() {}, clearRect() {}, fillText() {}, strokeRect() {} };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { Fish } = await import('../src/life.js');
configureModelLoading({ disabled: ['fish_a'] });
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('droplet and mist trajectories move with low tide and storm surge, including water contact', () => {
  let relativeMistHeight;
  for (const level of [-0.4, 0, 1.2]) {
    const spray = new Spray(2), plume = new Plume(2);
    spray.emit(1, level + 0.1, 2, 2, -3, 0, 0.02, 2);
    plume.emit(1, level - 0.2, 2, 2, -1, 0, 0.2, 0, 2);
    spray.update(0.05, level); plume.update(0.05, 1, level);
    close(spray.pos[1], level + 0.02);
    close(spray.vel[1], 0);
    relativeMistHeight ??= plume.pos[1] - level;
    close(plume.pos[1] - level, relativeMistHeight);
    assert.ok(relativeMistHeight > -0.2 && relativeMistHeight < 0.2);
    // Contact shortens life instead of leaving a permanent sheet of glitter on a tide-independent plane.
    for (let i = 0; i < 30; i++) spray.update(0.05, level);
    assert.equal(spray.count, 0);
    spray.geo.dispose(); spray.mat.dispose(); plume.geo.dispose(); plume.mat.dispose();
  }
});

test('gusts advect droplets, mist and smoke through the existing buffers', () => {
  const spray = new Spray(2), plume = new Plume(2);
  const buffers = [spray.pos, spray.vel, plume.pos, plume.vel, plume.data];
  spray.emit(0, 5, 0, 0, 0, 0, 0.02, 5);
  plume.emit(0, 5, 0, 0, 0, 0, 0.2, 0.1, 5);
  plume.emit(0, 5, 0, 0, 0, 0, 0.2, 0.1, 5, 0.5, true);
  for (let i = 0; i < 30; i++) { spray.update(1 / 60, 0, 12, -6); plume.update(1 / 60, i / 60, 0, 12, -6); }
  assert.ok(spray.pos[0] > 1.5 && spray.pos[2] < -0.7);
  assert.ok(plume.pos[0] > spray.pos[0]);
  assert.ok(plume.pos[3] > 0 && plume.pos[5] < 0);
  assert.ok(plume.pos[4] > 5); // Smoke rises freely; it does not inherit the mist's surface constraint.
  assert.ok(plume.baseAlpha[1] < 0);
  [spray.pos, spray.vel, plume.pos, plume.vel, plume.data].forEach((buffer, i) => assert.equal(buffer, buffers[i]));
  spray.geo.dispose(); spray.mat.dispose(); plume.geo.dispose(); plume.mat.dispose();
});

test('wind relaxation remains stable at 30 and 120 simulation updates per second', () => {
  const final = hz => {
    const spray = new Spray(1); spray.emit(0, 20, 0, -3, 0, 4, 0.02, 5);
    for (let i = 0; i < hz; i++) spray.update(1 / hz, 0, 10, -5);
    const velocity = [spray.vel[0], spray.vel[2]];
    spray.geo.dispose(); spray.mat.dispose(); return velocity;
  };
  const slow = final(30), fast = final(120);
  close(slow[0], fast[0]); close(slow[1], fast[1]);
});

test('fish launch and re-entry follow the water at their position across tides', () => {
  for (const level of [-0.4, 1.2]) {
    const splashes = [], surface = (x, z) => level + x * 0.02;
    const fish = new Fish({ heightAt: () => -4 }, new THREE.Scene(), {
      waveFn: surface, plume: { emit: (x, y) => splashes.push(y) }, spray: { emit() {} }, audio: { plip() {} }, emitStamp() {},
    });
    fish.activity = 0; fish.nextT = 100;
    const body = fish.launch(10, 0, 3, 1, 0, 1, 0, true);
    close(body.y, surface(10, 0) - 0.15);
    const phys = { pos: new THREE.Vector2(), wet: 1, speed: 0, groundH: -4 };
    for (let i = 0; i < 100 && body.on; i++) fish.update(1 / 60, i / 60, phys);
    assert.equal(body.on, false); assert.ok(splashes.length > 0);
    for (const y of splashes) close(y, surface(body.x, body.z) + 0.05);
    fish.mesh.geometry.dispose(); fish.mesh.material.dispose();
  }
});

test('hull spray uses the attitude water samples without extra wave queries', () => {
  const terrain = { heightAt: () => -5, gradAt: (x, z, out) => out.set(0, 0) };
  for (const heading of [0, 1.2, -2.3]) {
    const hull = new AirboatPhysics(terrain, 0, 0, heading); let queries = 0;
    hull.y = 0.8;
    const surface = (x, z) => { queries++; return 0.8 + x * 0.025 - z * 0.04; };
    const forward = hull.forward(new THREE.Vector2()), right = hull.right(new THREE.Vector2());
    hull.update(1 / 60, { throttle: 0, steer: 0, pitch: 0 }, surface, 0);
    assert.equal(queries, 5);
    close(hull.waterSlopeForward, forward.x * 0.025 - forward.y * 0.04);
    close(hull.waterSlopeRight, right.x * 0.025 - right.y * 0.04);
  }
});
