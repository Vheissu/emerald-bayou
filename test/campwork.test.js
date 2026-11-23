import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildCampWork, campWorkStep, poseCampWorker, updateCampWork } from '../src/campwork.js';
import { WorldHeight } from '../src/heightfield.js';
import { RESIDENT_ROUTINE } from '../src/residentroutines.js';
import { World } from '../src/world.js';

test('camp gear clears the bed at low tide and parks when the shoreline dries out', () => {
  const work = { bed: -0.38, phase: 0, stormHold: 0, y: 1.34 };
  for (let i = 0; i < 300; i++) campWorkStep(work, 1 / 60, 0, 0, 10, 0, RESIDENT_ROUTINE.OUTSIDE, 0.7, true);
  assert.ok(work.y > work.bed + 0.22 && work.y < -0.1);
  for (let i = 0; i < 120; i++) campWorkStep(work, 1 / 60, -0.3, 0, 10, 0, RESIDENT_ROUTINE.OUTSIDE, 0.7, true);
  assert.equal(work.parked, true);
  assert.ok(work.y > 1.2);
});

test('a fast pass or steep wake secures the load before work resumes', () => {
  const state = { bed: -1.8, phase: 4, stormHold: 0, y: -0.09 };
  const step = (wake = 0, speed = 0, routine = RESIDENT_ROUTINE.OUTSIDE) =>
    campWorkStep(state, 0.05, 0, wake, 20, speed, routine, 0.7, true);

  step(0, 8);
  assert.equal(state.parked, true);
  for (let i = 0; i < 48; i++) step();
  assert.ok(state.y > 1.2);
  assert.equal(state.parked, true);
  step(0.16);
  for (let i = 0; i < 72; i++) step();
  assert.equal(state.parked, false);
  step(0, 0, RESIDENT_ROUTINE.BRACE);
  assert.equal(state.parked, true);
});

test('working wharves reuse seeded mesh resources and animate an actual wet load', () => {
  const terrain = new WorldHeight(7);
  const world = new World({ hf: terrain }, null, null);
  const mullet = world.campAt(-1, 0), sawgrass = world.campAt(0, 0);
  const build = site => {
    const dock = new THREE.Group();
    dock.position.set(site.bank.x, 0, site.bank.z);
    dock.rotation.y = Math.atan2(site.tie.x - site.bank.x, site.tie.z - site.bank.z) + Math.PI;
    return buildCampWork(dock, site, -1, { heightAt: (x, z) => terrain.compute(x, z) });
  };
  const work = build(mullet), second = build(mullet), bait = build(sawgrass);
  assert.equal(work.cargo.geometry, second.cargo.geometry);
  assert.notEqual(work.cargo.geometry, bait.cargo.geometry);
  assert.equal(work.rope.geometry, bait.rope.geometry);
  assert.ok(work.bed < -0.4);
  let splashes = 0;
  const context = { bx: mullet.tie.x, bz: mullet.tie.z, dt: 1 / 60, speed: 0, humanActivity: 1,
    emitStamp: () => { splashes++; } };
  for (let i = 0; i < 10 * 60; i++) updateCampWork(work, i / 60, () => 0, { y: 0.55 }, context);
  assert.ok(splashes >= 2);
  assert.ok(work.rope.scale.y > 0.5);
  const retracted = work.y;
  work.worker.visible = false;
  updateCampWork(work, 10, () => 0, { y: 0.55 }, context);
  assert.equal(work.parked, true);
  assert.ok(work.y >= retracted);

  work.worker.visible = true;
  work.worker.userData.hoistGrip = 1;
  const hand = new THREE.Vector3();
  for (let i = 0; i < 12; i++) {
    work.drum.rotation.x = i * Math.PI / 6;
    poseCampWorker(work);
    const handle = work.drum.localToWorld(new THREE.Vector3(0.054, 0.16, 0));
    assert.ok(work.worker.userData.arms[1].hand.getWorldPosition(hand).distanceTo(handle) < 0.035);
  }
});

test('porch barrels catch local rain, keep dripping after it clears and pause with the game', async () => {
  const { buildRoofDrain, updateRoofDrain } = await import('../src/roofdrain.js');
  const a = buildRoofDrain(new THREE.Group()), b = buildRoofDrain(new THREE.Group());
  assert.equal(a.group.children[0].geometry, b.group.children[0].geometry);
  assert.notEqual(a.trickle.geometry, b.trickle.geometry);
  for (let i = 0; i < 600; i++) {
    updateRoofDrain(a, 1 / 60, 0.9, 16);
    updateRoofDrain(b, 1 / 60, 0, 1000);
  }
  assert.ok(a.fill > b.fill + 0.07 && a.trickle.visible && !b.trickle.visible);
  const level = a.fill, flow = a.flow, phase = a.phase;
  updateRoofDrain(a, 0, 0, 16);
  assert.equal(a.fill, level); assert.equal(a.phase, phase); assert.equal(a.flow, flow);
  updateRoofDrain(a, 1, 0, 16);
  assert.ok(a.trickle.visible && a.flow < flow && a.fill > level);
  updateRoofDrain(a, 0.1, 0, 10000); assert.equal(a.trickle.visible, false);
  for (let i = 0; i < 60; i++) updateRoofDrain(a, 1, 0, 16);
  assert.equal(a.trickle.visible, false);
});
