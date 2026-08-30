import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirboatPhysics } from '../src/airboat.js';
import { ANCHOR_BOTTOMS, BoatAnchor, anchorBottomProfile, anchorConstraintForce, anchorHoldingCapacity, anchorRode } from '../src/anchor.js';

const terrain = {
  hf: { computeBase: () => ({ h: -3, s: 0.9, lake: 0, prairie: 0 }) },
  heightAt: () => -3,
  gradAt: (x, z, out) => out.set(0, 0),
};

test('anchor rode grows with depth while staying within the boat locker limits', () => {
  const shallow = anchorRode(1), deep = anchorRode(7);
  assert.ok(deep.scope > shallow.scope);
  assert.ok(deep.slack > shallow.slack);
  assert.equal(anchorRode(99).scope, 30);
  assert.equal(anchorRode(0).depth, 0.6);
});

test('bottom composition changes anchor holding capacity', () => {
  assert.equal(anchorBottomProfile({ lake: 0.8 }), ANCHOR_BOTTOMS.muck);
  assert.equal(anchorBottomProfile({ prairie: 0.8 }), ANCHOR_BOTTOMS.grass);
  assert.equal(anchorBottomProfile({ h: -0.8, s: 0.7 }), ANCHOR_BOTTOMS.shell);
  assert.equal(anchorBottomProfile({ h: -4, s: 0.8 }), ANCHOR_BOTTOMS.mud);
  assert.ok(anchorHoldingCapacity(ANCHOR_BOTTOMS.mud, 4) > anchorHoldingCapacity(ANCHOR_BOTTOMS.grass, 4));
});

test('anchor constraint reuses caller output and pulls the bow toward the set', () => {
  const state = { active: true, engaged: true, x: 0, z: 0, slack: 2, capacity: 4 };
  const out = {};
  assert.equal(anchorConstraintForce(state, 1, 0, 1, 0, out), out);
  assert.equal(out.taut, false);
  assert.equal(anchorConstraintForce(state, 5, 0, 2, 0, out), out);
  assert.equal(out.taut, true);
  assert.ok(out.x < 0);
  assert.ok(Math.abs(out.z) < 1e-9);
  assert.ok(out.load > 1);
  assert.equal(state.load, out.load);
});

test('an engaged anchor bounds tidal drift and swings the bow into the load', () => {
  const input = { throttle: 0, steer: 0, pitch: 0 }, flow = new THREE.Vector2(1.1, 0.2);
  const free = new AirboatPhysics(terrain, 0, 0, 0), held = new AirboatPhysics(terrain, 0, 0, 0);
  held.anchorConstraint = { active: true, engaged: true, x: 0, z: 0, slack: 3, capacity: 4, load: 0, force: 0, taut: false };
  for (let frame = 0; frame < 1200; frame++) {
    free.update(1 / 60, input, () => 0, frame / 60, flow);
    held.update(1 / 60, input, () => 0, frame / 60, flow);
  }
  assert.ok(free.pos.length() > 18);
  assert.ok(held.pos.length() < 5);
  assert.ok(Math.abs(held.heading) > 0.3);
});

test('boat anchor reuses one line buffer across drops and resets with the hull', () => {
  const scene = new THREE.Scene(), phys = new AirboatPhysics(terrain, 0, 0, 0);
  phys.y = 0;
  const toasts = [], listeners = new Map();
  const eventTarget = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
  };
  const anchor = new BoatAnchor({
    scene, terrain, phys, water: { level: 0 }, eventTarget,
    game: { playing: true, paused: false, inputLock: false, menuOpen: false, mapOpen: false, resultOpen: false, toast: (...args) => toasts.push(args) },
    audio: { thud() {}, warn() {} }, environment: { values: { wind: 3, sea: 0.1 }, gust: 1 },
    currents: { flowAt: (x, z, out) => out.set(0.3, 0) },
  });
  anchor.update(0, 0, true);
  const array = anchor.geometry.attributes.position.array, geometry = anchor.geometry, material = anchor.material;
  assert.equal(anchor.deploy(), true);
  anchor.update(1.2, 1.2, true);
  assert.equal(anchor.state.engaged, true);
  assert.equal(anchor.line.visible, true);
  assert.equal(anchor.geometry.attributes.position.array, array);
  assert.deepEqual(anchor.resourceStats(), {
    active: true, status: 'set', load: 0, draggedMetres: 0,
    drawCalls: 1, geometries: 1, materials: 1, textures: 0, geometryBytes: 144,
  });

  phys.reset(12, 8, 0);
  anchor.update(1 / 60, 2, true);
  assert.equal(anchor.state.active, false);
  assert.equal(anchor.line.visible, false);
  assert.equal(anchor.geometry, geometry);
  assert.equal(anchor.material, material);
  assert.equal(toasts.length, 1);
  anchor.dispose();
  assert.equal(listeners.size, 0);
});
