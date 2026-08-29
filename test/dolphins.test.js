import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DolphinPod, dolphinHabitatPotential, dolphinVesselResponse } from '../src/dolphins.js';

test('dolphin habitat is limited to calm, deep estuarine water', () => {
  const calm = dolphinHabitatPotential({ regionId: 'broad', depth: 4.2, storm: 0, wind: 3, rain: 0, fish: 1.1, tideRate: 0.18 });
  assert.ok(calm > 0.7);
  assert.ok(dolphinHabitatPotential({ regionId: 'mangrove', depth: 3.4, storm: 0.1, wind: 4, fish: 1.25 }) > 0.65);
  assert.equal(dolphinHabitatPotential({ regionId: 'emerald', depth: 6, storm: 0, wind: 2, fish: 1.2 }), 0);
  assert.equal(dolphinHabitatPotential({ regionId: 'broad', depth: 1.2, storm: 0, wind: 2, fish: 1.2 }), 0);
  assert.equal(dolphinHabitatPotential({ regionId: 'broad', depth: 5, storm: 1, wind: 36, rain: 1, fish: 1.2 }), 0);
});

test('a bow approach rewards predictable navigation and rejects pursuit', () => {
  assert.equal(dolphinVesselResponse({ state: 'travel', distance: 82, boatSpeed: 4.5, turnRate: 0.03, headingAlignment: 0.9, pursuitSeconds: 0 }), 'approach');
  assert.equal(dolphinVesselResponse({ state: 'approach', distance: 22, boatSpeed: 4.2, turnRate: 0.08, headingAlignment: 0.1, pursuitSeconds: 0 }), 'approach');
  assert.equal(dolphinVesselResponse({ state: 'ride', distance: 9, boatSpeed: 4.8, turnRate: 0.05, headingAlignment: 0.86, pursuitSeconds: 0 }), 'ride');
  assert.equal(dolphinVesselResponse({ state: 'travel', distance: 60, boatSpeed: 5, turnRate: 0.11, headingAlignment: 0.95, pursuitSeconds: 3.2 }), 'avoid');
  assert.equal(dolphinVesselResponse({ state: 'ride', distance: 18, boatSpeed: 11.5, turnRate: 0.04, headingAlignment: 0.9, pursuitSeconds: 0 }), 'avoid');
  assert.equal(dolphinVesselResponse({ state: 'ride', distance: 24, boatSpeed: 4, turnRate: 0.52, headingAlignment: 0.9, pursuitSeconds: 0 }), 'avoid');
});

test('the live pod keeps one fixed shared resource pool', () => {
  const scene = new THREE.Scene();
  const calls = { bounty: '', attention: 0, reason: '', fwc: 0, persisted: 0 };
  const phys = {
    pos: new THREE.Vector2(7100, 0), heading: 0, speed: 4, angVel: 0, airborne: false, hit: 0,
    vel: new THREE.Vector2(), hitNormal: new THREE.Vector2(), vy: 0, rollVel: 0,
    forward(out) { return out.set(-Math.sin(this.heading), -Math.cos(this.heading)); },
    right(out) { return out.set(-Math.cos(this.heading), Math.sin(this.heading)); },
  };
  const broad = { id: 'broad', ecology: { fish: 0.9 } };
  const game = { save: {}, toast() {}, persist() { calls.persisted++; }, bounties: { event(kind) { calls.bounty = kind; } }, tricks: { bust() {} }, shake: 0, life: { traffic: { activeCollision: () => false } } };
  const pod = new DolphinPod({
    scene, terrain: { heightAt: () => -4 }, world: { blockedAt: () => false }, water: { waveHeight: () => 0 }, phys, game,
    audio: {}, environment: { waterLevel: 0, values: { storm: 0, wind: 3, rain: 0 }, gust: 1, tideRate: 0.12, day: 1 },
    regions: { current: broad },
    law: { add(amount, reason) { calls.attention += amount; calls.reason = reason; } },
    reputation: { change(faction, amount) { if (faction === 'fwc') calls.fwc += amount; } },
    radio: {}, regionAtFn: () => broad,
  });
  const before = pod.resourceStats(); let meshes = 0;
  pod.root.traverse(object => { if (object.isMesh) meshes++; });
  assert.deepEqual({ animals: before.animals, meshes: before.meshes, geometries: before.geometries, materials: before.materials, wakeCapacity: before.wakeCapacity }, { animals: 4, meshes: 8, geometries: 2, materials: 1, wakeCapacity: 8 });
  assert.equal(meshes, 8);
  assert.equal(pod.debugStart(), true);
  for (let i = 0; i < 180; i++) pod.update(1 / 60, i / 60, true);
  const after = pod.resourceStats();
  assert.deepEqual({ animals: after.animals, meshes: after.meshes, geometries: after.geometries, materials: after.materials, wakeCapacity: after.wakeCapacity }, { animals: 4, meshes: 8, geometries: 2, materials: 1, wakeCapacity: 8 });
  assert.ok(after.wakeActive <= after.wakeCapacity);
  assert.equal(after.wakeDroppedTotal, 0);
  assert.ok(after.vertices > 0 && after.geometryBytes > 0);
  pod.logRide();
  assert.equal(game.save.nature.dolphinPasses, 1); assert.equal(calls.bounty, 'dolphinpass');
  pod.disturb('vessel pursuit');
  assert.equal(game.save.nature.dolphinDisturbances, 1); assert.equal(pod.state, 'avoid');
  assert.ok(calls.attention >= 0.45); assert.match(calls.reason, /marine mammal harassment/); assert.ok(calls.fwc < 0); assert.ok(calls.persisted > 0);
  pod.dispose();
});
