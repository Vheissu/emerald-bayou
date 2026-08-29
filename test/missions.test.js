import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildMissions } from '../src/game.js';
import { WorldHeight } from '../src/heightfield.js';

function missionGame() {
  const height = new WorldHeight(7);
  const T = {
    bars: height.bars, lagoon: height.lagoon,
    heightAt: (x, z) => height.compute(x, z),
    riverCenterX: z => height.riverCenterX(z), riverHalfWidth: z => height.riverHalfWidth(z),
  };
  const startZ = 70, startX = T.riverCenterX(startZ);
  return {
    T, startX, startZ, dockTie: { x: startX + 8, z: startZ - 12 }, scene: new THREE.Scene(), boat: new THREE.Group(),
    phys: { loaded: 0, pos: new THREE.Vector2(startX, startZ), heading: 0 },
    audio: { checkpoint() {}, warn() {}, pickup() {} }, toast() {},
    river(z, side = 0) { return { x: T.riverCenterX(z) + side * T.riverHalfWidth(z) * 0.45, z }; },
    headingTo(ax, az, bx, bz) { return Math.atan2(-(bx - ax), -(bz - az)); },
    findSpot(seed, zMin) { return { x: T.riverCenterX(zMin) + 60, z: zMin, h: -1 }; },
  };
}

test('adds the three race formats after the existing campaign', () => {
  const G = missionGame(), missions = buildMissions(G);
  assert.deepEqual(missions.slice(-3).map(m => m.id), ['splits', 'rampcircuit', 'relay']);
  assert.equal(missions.length, 16);

  const splitState = {}; missions.at(-3).setup(splitState, G);
  assert.ok(splitState.limitOverride > 0);

  const rampStart = missions.at(-2).start(G);
  assert.ok(Number.isFinite(rampStart.x) && Number.isFinite(rampStart.z) && Number.isFinite(rampStart.heading));
});

test('dispatch relay removes every temporary case during cleanup', () => {
  const G = missionGame(), relay = buildMissions(G).at(-1), state = {};
  relay.setup(state, G);
  assert.equal(state.cases.length, 3);
  assert.equal(G.scene.children.length, 3);

  relay.attach(state, G);
  assert.equal(state.stage, 'route');
  assert.equal(state.cases[0].m.parent, G.boat);
  assert.equal(G.phys.loaded, 0.42);

  relay.eject(state, G, 'Test collision');
  assert.equal(state.stage, 'recover');
  assert.equal(state.cases[0].m.parent, G.scene);
  relay.attach(state, G, true);
  assert.equal(state.cases[0].m.parent, G.boat);

  relay.cleanup(state, G);
  assert.equal(G.scene.children.length, 0);
  assert.ok(state.cases.every(box => box.m.parent === null));
});
