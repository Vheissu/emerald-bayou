import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { attachDockResident, attachLandingResident, dockShelterPath, updateDockResident } from '../src/dockresidents.js';
import { Ecology } from '../src/ecology.js';
import { WorldHeight } from '../src/heightfield.js';
import { applyResidentRoutines, RESIDENT_ROUTINE } from '../src/residentroutines.js';
import { DOCK_SHELTER, positionDockShelter } from '../src/tower.js';
import { World } from '../src/world.js';

const dt = 1 / 30;
const sampleBoat = (x, vx = 0, wake = 0) => ({ x, z: 0, vx, vz: 0, speed: Math.abs(vx), wake });
const fair = { role: 'camp', hour: 10.2, day: 1, storm: 0, rain: 0, wind: 1, distance: 20, playerSpeed: 0 };
function fixture() {
  const group = new THREE.Group(), actor = new THREE.Group();
  group.add(actor);
  actor.userData.seed = 0.6;
  group.userData.people = [actor];
  const state = attachDockResident(actor, [new THREE.Vector3(), new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 1, 5)]);
  applyResidentRoutines(group, { ...fair });
  const advance = (boat, seconds) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) updateDockResident(actor, dt, boat);
  };
  return { actor, advance, state };
}

test('a parked boat stays quiet, an approach gets one greeting, and leaving re-arms it', () => {
  const { advance, state } = fixture();
  advance(sampleBoat(14), 90);
  assert.equal(state.state, 'idle');
  advance(sampleBoat(35, -2.2), 0.9);
  assert.equal(state.state, 'notice');
  advance(sampleBoat(15, -1.2), 0.3);
  assert.equal(state.state, 'greet');
  advance(sampleBoat(10), 70);
  assert.equal(state.state, 'idle');
  assert.equal(state.visited, true);
  advance(sampleBoat(67), 1.8);
  assert.equal(state.visited, true);
  advance(sampleBoat(67), 0.4);
  assert.equal(state.visited, false);
  advance(sampleBoat(34, -2), 1);
  advance(sampleBoat(14), 0.3);
  assert.equal(state.state, 'greet');
});

test('unsafe arrivals step back on the deck and recover without a greeting', () => {
  const { advance, actor, state } = fixture();
  advance(sampleBoat(31, -7), 0.7);
  assert.equal(state.state, 'notice');
  advance(sampleBoat(12, -7), 1.25);
  assert.equal(state.state, 'brace');
  assert.equal(state.reason, 'wake');
  assert.equal(state.rest, 0);
  assert.ok(actor.position.z > 0.75 && actor.position.z < 1.04);
  const distance = state.distanceWalked;
  advance(sampleBoat(12, 0, 0.13), 0.3);
  assert.equal(state.state, 'brace');
  advance(sampleBoat(9), 4.5);
  assert.equal(state.state, 'idle');
  assert.equal(state.rest, 1);
  assert.equal(actor.position.z, 0);
  assert.ok(state.distanceWalked > distance + 0.75);
});

test('Mullet Bend residents follow the dock deck into cover and return after a dry grace period', () => {
  const height = new WorldHeight(7);
  const terrain = { hf: height, heightAt: (x, z) => height.compute(x, z) };
  const world = new World(terrain, new THREE.Scene(), () => 0);
  const site = world.campAt(-1, 0), group = new THREE.Group(), dock = new THREE.Group();
  group.add(dock);
  const waterYaw = Math.atan2(site.tie.x - site.bank.x, site.tie.z - site.bank.z);
  dock.position.set(site.bank.x, 0, site.bank.z); dock.rotation.y = waterYaw + Math.PI;
  const boat = { ...sampleBoat(site.tie.x), z: site.tie.z };
  const people = [-0.72, 0.72].map(slot => {
    const actor = new THREE.Group();
    actor.userData.rod = slot > 0;
    actor.position.set(slot, 0.81, -12.6); dock.add(actor);
    attachDockResident(actor, dockShelterPath(dock, actor, Math.sign(slot)), { hoist: slot < 0 });
    return actor;
  });
  group.userData.people = people;
  for (const actor of people) {
    const state = actor.userData.dockReaction, dockStart = actor.getWorldPosition(new THREE.Vector3());
    applyResidentRoutines(group, { ...fair }); updateDockResident(actor, dt, boat);
    applyResidentRoutines(group, { ...fair, storm: 0.95, rain: 0.99, wind: 22 });
    for (let i = 0; i < 32; i++) updateDockResident(actor, dt, boat);
    assert.equal(state.state, 'secure');
    assert.ok(actor.getWorldPosition(new THREE.Vector3()).distanceTo(dockStart) < 0.001);
    assert.equal(actor.visible, true);
    let walked = false;
    for (let i = 0; i < 600; i++) {
      const old = actor.position.clone();
      updateDockResident(actor, dt, boat);
      if (state.state === 'evacuate' && state.gait > 0.2) walked = true;
      assert.ok(actor.position.distanceTo(old) < 0.065, 'the actor advances without teleporting');
    }
    assert.ok(walked);
    assert.equal(state.state, 'sheltered');
    assert.equal(actor.visible, true);
    assert.equal(actor.userData.routineState, RESIDENT_ROUTINE.INSIDE);
    const point = actor.position;
    assert.ok(Math.abs(Math.abs(point.x) - DOCK_SHELTER.berthX) < 0.01);
    assert.ok(Math.abs(point.y - DOCK_SHELTER.deck) < 0.01 && Math.abs(point.z - DOCK_SHELTER.berthZ) <= 0.43);
    const distance = state.distanceWalked;
    applyResidentRoutines(group, { ...fair });
    for (let i = 0; i < 100; i++) updateDockResident(actor, dt, boat);
    assert.equal(state.state, 'sheltered');
    for (let i = 0; i < 780; i++) updateDockResident(actor, dt, boat);
    assert.equal(state.state, 'idle');
    assert.ok(state.distanceWalked > distance * 1.99);
    assert.ok(actor.getWorldPosition(new THREE.Vector3()).distanceTo(dockStart) < 0.001);
  }
});

test('dock weather uses the landing location even when the player is between storm bands', () => {
  const { actor } = fixture();
  const group = actor.parent; group.userData.dockResidents = [actor];
  const site = { x: 600, z: 500, tie: { x: 640, z: 520 } };
  const instrumentation = [];
  const ecology = {
    environment: { gust: 0.9, values: { storm: 0, rain: 0, wind: 1 },
      sampleStormAt: (x, z) => { instrumentation.push([x, z]); return 0.9; },
      sampleRainAt: () => 0.95, sampleWindAt: () => 26 },
    residentRoutineInput: { ...fair }, phys: { pos: { x: 0, y: 0 } },
  };
  Ecology.prototype.applyResidentGroup.call(ecology, group, site, 'camp');
  assert.deepEqual(instrumentation, [[640, 520]]);
  assert.equal(actor.userData.routineDesired, RESIDENT_ROUTINE.INSIDE);
  assert.equal(actor.userData.routineWeather, 'storm');
  assert.equal(actor.visible, true, 'the decision leaves visibility to the staged animation');
});

test('dock windbreaks move away from rising ground and shed the roof when the deck stays buried', () => {
  const dock = new THREE.Group(), person = new THREE.Group();
  const roof = new THREE.Group(); dock.add(roof, person); dock.userData.dockShelter = roof;
  person.position.set(0.7, DOCK_SHELTER.deck, -12);
  assert.equal(positionDockShelter(dock, { heightAt: (_, z) => z > -3.5 ? 3 : 0 }), roof);
  assert.ok(roof.position.z < -1.72);
  const berth = dockShelterPath(dock, person, 1).at(-1);
  assert.equal(berth.z, DOCK_SHELTER.berthZ - 0.42 + roof.position.z);
  assert.equal(positionDockShelter(dock, { heightAt: () => 8 }), null);
  assert.equal(roof.parent, null);
});

test('residents at an exposed landing greet, secure gear and stay visible on the boards', () => {
  for (const hasClearStep of [true, false]) {
    const dock = new THREE.Group(), person = new THREE.Group();
    dock.add(person);
    dock.userData.people = [person];
    person.position.set(0.72, DOCK_SHELTER.deck, -12.6);
    const foot = person.position.clone();
    const state = attachLandingResident(dock, person, { heightAt: x => hasClearStep || x > 0.59 ? 0 : 1.45 }, 1, { hoist: true });
    assert.equal(state.hasShelter, false);
    assert.equal(state.total > 0, hasClearStep);
    const advance = (boat, seconds) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        updateDockResident(person, dt, { ...boat, z: foot.z });
        assert.equal(person.visible, true);
      }
    };

    applyResidentRoutines(dock, { ...fair });
    advance(sampleBoat(30, -2.2), 0.7);
    assert.equal(state.state, 'notice');
    advance(sampleBoat(14, -1), 0.25);
    assert.equal(state.state, 'greet');
    advance(sampleBoat(10), 30);
    assert.equal(state.state, 'idle');
    assert.ok(state.visited);

    applyResidentRoutines(dock, { ...fair, storm: 0.95, rain: 0.99, wind: 24 });
    advance(sampleBoat(10), 1);
    assert.equal(state.state, 'secure');
    assert.ok(state.grip > 0.9 && foot.distanceTo(person.position) < 0.001);
    advance(sampleBoat(10), 28);
    assert.equal(state.state, 'brace');
    assert.equal(state.reason, 'storm');
    assert.equal(state.grip, 0);
    assert.ok(Math.abs(state.distance - state.total) < 0.001);
    assert.equal(person.position.y, DOCK_SHELTER.deck);
    assert.equal(person.userData.routineState, RESIDENT_ROUTINE.BRACE);

    applyResidentRoutines(dock, { ...fair });
    advance(sampleBoat(10), 3);
    assert.equal(state.state, 'brace');
    advance(sampleBoat(10), 5);
    assert.equal(state.state, 'idle');
    assert.ok(foot.distanceTo(person.position) < 0.001);
  }
});
