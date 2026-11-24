import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildFishingCrew } from '../src/skifffishingcrew.js';
import { updateDockActors } from '../src/skiffdockactors.js';
import { buildDockGear, createCreelFish, PAIL_HANDLE, TOTE_HANDLES } from '../src/skiffdockgear.js';
import { createDockShift, stepDockShift } from '../src/skiffdockshift.js';
import { COVE_MOORINGS } from '../src/waterfrontlayout.js';

const dt = 1 / 60;
const vec = (point) => new THREE.Vector3(point.x, point.y, point.z);
function setup(index = 0) {
  const scene = new THREE.Group(), mesh = new THREE.Group(), berth = COVE_MOORINGS[index];
  const trip = { secured: true, timer: 15 + index * 9, storm: false };
  const boat = { berth, mesh, trip };
  scene.add(mesh);
  mesh.rotation.order = 'YXZ';
  boat.crew = buildFishingCrew(boat, index);
  boat.dockGear = buildDockGear(boat, index, scene);
  boat.dockGear.sortFish = createCreelFish();
  scene.add(boat.dockGear.sortFish);
  const shift = createDockShift(berth, index), ctx = { bx: berth.x + 10, bz: berth.z, speed: 0 };
  let t = 0;
  return {
    boat, shift,
    advance(step = dt, bobbing = true) {
      trip.timer -= step;
      t += step;
      if (bobbing) {
        mesh.position.set(berth.x + Math.sin(t * 0.93) * 0.05, 0.17 + Math.cos(t) * 0.11, berth.z);
        mesh.rotation.set(Math.sin(t) * 0.03, -Math.PI / 2, Math.cos(t) * 0.06);
      }
      stepDockShift(shift, trip, step);
      return updateDockActors(boat, shift, step, t, ctx);
    },
  };
}

function handGap(hand, prop, grip) {
  return hand.getWorldPosition(new THREE.Vector3()).distanceTo(prop.localToWorld(vec(grip)));
}

test('crew boots meet the dock and both hands stay with the gear through the carry', () => {
  for (const index of [0, 1]) {
    const { boat, shift, advance } = setup(index);
    assert.equal(advance(0), true);
    for (const figure of [boat.crew.helm, boat.crew.angler]) {
      assert.ok(Math.abs(figure.getWorldPosition(new THREE.Vector3()).y - boat.berth.pier.deck) < 1e-8);
    }
    assert.equal(boat.crew.angler.userData.rod.visible, false);
    let toteContact = false, pailContact = false;
    for (let i = 0; i < 23 / dt; i++) {
      advance();
      if (shift.helm.action === 'carry' && shift.helm.actionProgress > 0.12 && shift.helm.from.space === 'dock') {
        for (let hand = 0; hand < 2; hand++) {
          assert.ok(handGap(boat.crew.helm.userData.arms[hand].hand, boat.dockGear.cooler, TOTE_HANDLES[hand]) < 0.045);
        }
        const soles = boat.crew.helm.userData.legs.map(({ boot }) => boot.localToWorld(new THREE.Vector3(0, -0.046, 0)).y);
        assert.ok(soles.every(y => y > boat.berth.pier.deck - 0.045));
        assert.ok(soles.some(y => Math.abs(y - boat.berth.pier.deck) < 0.04));
        toteContact = true;
      }
      if (shift.angler.action === 'carry' && shift.angler.actionProgress > 0.1 && shift.angler.from.space === 'dock') {
        assert.ok(handGap(boat.crew.angler.userData.arms[1].hand, boat.dockGear.tackle, PAIL_HANDLE) < 0.045);
        pailContact = true;
      }
    }
    assert.ok(toteContact && pailContact);
  }
});

test('boarding blends onto the moving hull and passes the original figures back to fishing', () => {
  const { boat, shift, advance } = setup();
  const original = [boat.crew.helm, boat.crew.angler];
  const last = [new THREE.Vector3(), new THREE.Vector3()];
  const now = new THREE.Vector3();
  let sawCrossing = false;
  advance(0);
  original.forEach((figure, i) => figure.getWorldPosition(last[i]));
  for (let frame = 0; frame < 23 / dt && !shift.ready; frame++) {
    advance();
    sawCrossing ||= shift.helm.action === 'board' && shift.helm.from.space !== shift.helm.to.space;
    original.forEach((figure, i) => {
      assert.equal(figure.parent, boat.mesh);
      figure.getWorldPosition(now);
      assert.ok(last[i].distanceTo(now) < 0.085);
      last[i].copy(now);
    });
  }
  assert.ok(sawCrossing && shift.ready);
  boat.trip.secured = false;
  assert.equal(advance(), false);
  assert.equal(boat.crew.helm, original[0]);
  assert.equal(boat.crew.angler, original[1]);
  assert.equal(boat.crew.angler.userData.rod.visible, true);
  original.forEach((figure, i) => {
    assert.ok(figure.getWorldPosition(now).distanceTo(last[i]) < 0.03);
  });
});

test('pausing a turn leaves gait, body and prop orientation unchanged', () => {
  const { boat, shift, advance } = setup();
  while (shift.helm.action !== 'carry') advance();
  const figure = boat.crew.helm, cooler = boat.dockGear.cooler;
  const pose = [
    figure.position.clone(),
    figure.quaternion.clone(),
    figure.userData.legs[0].thigh.quaternion.clone(),
    figure.userData.arms[0].fore.quaternion.clone(),
    cooler.position.clone(), cooler.quaternion.clone(),
  ];
  for (let i = 0; i < 60; i++) advance(0, false);
  const retained = [
    figure.position, figure.quaternion, figure.userData.legs[0].thigh.quaternion,
    figure.userData.arms[0].fore.quaternion, cooler.position, cooler.quaternion,
  ];
  for (let i = 0; i < pose.length; i++) assert.ok(pose[i].toArray().every((v, k) => Math.abs(v - retained[i].toArray()[k]) < 1e-12));
});

test('each dockhand carries one fish from the ice to the pan on their sorting side', () => {
  for (const index of [0, 1]) {
    const { boat, shift, advance } = setup(index);
    for (let t = 0; t < 23 / dt && !shift.ready; t++) advance();
    boat.trip.secured = false;
    boat.trip.catchCount = 1;
    advance();
    assert.equal(boat.dockGear.sortFish.visible, false);
    boat.trip.secured = true;
    boat.trip.storm = true;
    for (let t = 0; t < 23 / dt && (!shift.sorting || shift.sortProgress < 0.29); t++) advance();
    const fish = boat.dockGear.sortFish;
    const jaw = fish.getWorldPosition(new THREE.Vector3());
    assert.ok(shift.sorting && fish.visible);
    assert.ok(vec(shift.sortFrom).distanceTo(jaw) < .072);
    while (shift.sortProgress < .75) advance();
    assert.ok(fish.visible);
    assert.ok(vec(shift.sortTo).distanceTo(fish.getWorldPosition(jaw)) < .072);
    while (shift.sortProgress < .83) advance();
    assert.equal(fish.visible, false);
    assert.equal(shift.landedCount, 1);
    assert.equal(shift.gear.cooler.count, 0);
  }
});
