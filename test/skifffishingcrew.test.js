import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildSkiff } from '../src/npc.js';
import { buildFishingCrew, updateFishingCrew } from '../src/skifffishingcrew.js';

const wave = (x, z, time) => 0.12 + Math.sin(x * 0.2 + z * 0.3 + time) * 0.09;
const secondsPerTick = 1 / 60;

function setup() {
  const boat = { mesh: buildSkiff({ crew: false }), roll: 0.07 };
  boat.mesh.position.set(22, 0.125, -35);
  boat.mesh.rotation.set(0.08, 0.63, boat.roll, 'YXZ');
  const crew = buildFishingCrew(boat, 1);
  const trip = { phase: 'fishing', alarm: 0 };
  const contacts = [];
  const ctx = { bx: 28, bz: -35, speed: 4, heightAt: () => -2.4, emitStamp: (...args) => contacts.push(args) };
  let tick = 0;
  function advance(seconds) {
    for (let i = 0; i < seconds * 60; i++) {
      tick++;
      updateFishingCrew(crew, boat, trip, secondsPerTick, tick * secondsPerTick, ctx, wave);
    }
    return tick * secondsPerTick;
  }
  return { boat, crew, trip, ctx, contacts, advance };
}

test('the fishing line leaves the rod, lands on a wave, and clears during a storm return', () => {
  const { boat, crew, trip, contacts, advance } = setup();
  const time = advance(4);
  assert.equal(crew.rigging, 'soaking');
  assert.equal(contacts.length, 1);
  assert.ok(crew.line.visible && crew.float.visible);
  const worldFloat = crew.float.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(worldFloat.y - wave(worldFloat.x, worldFloat.z, time)) < 0.003);
  const points = crew.line.geometry.attributes.position;
  const renderedFloat = boat.mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(points, 1));
  const renderedTip = boat.mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(points, 0));
  assert.ok(renderedFloat.distanceTo(worldFloat) < 0.0001);
  assert.ok(renderedTip.distanceTo(crew.angler.userData.tip.getWorldPosition(new THREE.Vector3())) < 0.0001);

  trip.phase = 'returning';
  trip.storm = true;
  advance(0.25);
  assert.equal(crew.rigging, 'reeling');
  advance(2);
  assert.equal(crew.rigging, 'idle');
  assert.equal(crew.line.visible, false);
  assert.ok(crew.raised < 0.1, 'angler sits low for the return');
});

test('a cast over exposed ground stays stowed and a close approach draws a visible response', () => {
  const { boat, crew, trip, ctx, contacts, advance } = setup();
  ctx.heightAt = () => 1.3;
  advance(4);
  assert.equal(contacts.length, 0);
  assert.equal(crew.line.visible, false);
  const previous = crew.angler.userData.cur.lf;
  trip.reaction = 'hail';
  advance(0.6);
  assert.ok(crew.angler.userData.cur.lf > previous + 0.75);

  const leftHand = crew.helm.userData.arms[0].hand.getWorldPosition(new THREE.Vector3());
  const motor = boat.mesh.userData.motor;
  const grip = motor.localToWorld(new THREE.Vector3(-0.16, 0.22, -0.80));
  assert.ok(leftHand.distanceTo(grip) < 0.055);
});
